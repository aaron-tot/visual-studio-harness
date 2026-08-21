import { inArray, eq } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns, stepParts, summaryRanges } from "../../db/schema";
import type { ModelMessage as CoreMessage } from "ai";
import { parsePartData, replayPartsToMessages, type ReplayPartOptions } from "./replay-parts";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

export interface BuildModelMessagesOptions {
  contextTurnIds: number[];
  includeIncompleteTurns: boolean;
  includeTextParts: boolean;
  includeTools: boolean;
  includeReasoningParts: boolean;
  includePatchParts: boolean;
  includeOtherParts: boolean;
  currentTurnNumber: number;
  firstTurnNumber?: number | null; // slider position (firstTurnNumber from context config)
  currentUserMessage: string;
}

export interface BuildModelMessagesResult {
  messages: CoreMessage[];
  contextTurnIds: number[];
  systemBlock: string;
}

/** Prefix that marks a summary context carrier (exempt in the single-system-message guard). */
export const SUMMARY_CARRIER_PREFIX = "◇ Conversation summary";

/**
 * Builds the labeled system carrier that represents a summary turn in the main
 * session's model context. The summarizer's handoff prompt (stored in the
 * summary turn's `userContent`) MUST NOT reach the main agent — the summary
 * text is carried alone as reference context.
 */
function summaryCarrier(
  summaryText: string,
  range: { startTurn: number; endTurn: number } | undefined,
): CoreMessage {
  const label = range
    ? `${SUMMARY_CARRIER_PREFIX} (turns ${range.startTurn}–${range.endTurn}):`
    : `${SUMMARY_CARRIER_PREFIX}:`;
  return { role: "system", content: `${label}\n${summaryText}` };
}

export async function buildModelMessages(
  sessionId: string,
  systemBlock: string,
  options: BuildModelMessagesOptions,
  dataDir?: string,
): Promise<BuildModelMessagesResult> {
  const db = dbFor(dataDir);

  // Summary turns are reference context, NOT dialogue: the user side of a
  // summary row is the summarizer's handoff prompt and must never be replayed
  // to the main agent. Each summary row in range is emitted as ONE labeled
  // system message carrying the full summary text (same source as the UI
  // collapsible card). The label reads the covered range from summary_ranges.
  const rangeBySummaryTurn = new Map<number, { startTurn: number; endTurn: number }>();
  const rangeRows = db
    .select({
      summaryTurnId: summaryRanges.summaryTurnId,
      startTurn: summaryRanges.startTurn,
      endTurn: summaryRanges.endTurn,
    })
    .from(summaryRanges)
    .where(eq(summaryRanges.sessionId, sessionId))
    .all();
  for (const r of rangeRows) rangeBySummaryTurn.set(r.summaryTurnId, { startTurn: r.startTurn, endTurn: r.endTurn });

  // 1. Filter contextTurnIds by completion status
  let filteredTurnIds = [...options.contextTurnIds];

  // Filter by completion status
  if (!options.includeIncompleteTurns && filteredTurnIds.length > 0) {
    const turnRows = db
      .select({ id: turns.id, turnNumber: turns.turnNumber, status: turns.status, success: turns.success })
      .from(turns)
      .where(inArray(turns.id, filteredTurnIds))
      .all();

    const completedIds = new Set(
      turnRows
        .filter((t) => t.success === true && t.status === "success" && t.turnNumber < options.currentTurnNumber)
        .map((t) => t.id),
    );

    filteredTurnIds = filteredTurnIds.filter((id) => completedIds.has(id));
  } else {
    // Even with includeIncompleteTurns, exclude current and future turns
    const turnRows = db
      .select({ id: turns.id, turnNumber: turns.turnNumber })
      .from(turns)
      .where(inArray(turns.id, filteredTurnIds))
      .all();

    const validIds = new Set(
      turnRows.filter((t) => t.turnNumber < options.currentTurnNumber).map((t) => t.id),
    );

    filteredTurnIds = filteredTurnIds.filter((id) => validIds.has(id));
  }

  // 2. Fetch all turns and their stepParts in batch
  const messages: CoreMessage[] = [];

  if (filteredTurnIds.length > 0) {
    // Fetch turn metadata
    const turnRows = db
      .select({
        id: turns.id,
        turnNumber: turns.turnNumber,
        kind: turns.kind,
        userContent: turns.userContent,
        userTimestamp: turns.userTimestamp,
      })
      .from(turns)
      .where(inArray(turns.id, filteredTurnIds))
      .orderBy(turns.turnNumber)
      .all();

    const turnById = new Map(turnRows.map((t) => [t.id, t]));

    // Fetch ALL stepParts for these turns in one query (seq is turn-global).
    const partRows = db
      .select({
        turnId: stepParts.turnId,
        type: stepParts.type,
        data: stepParts.data,
        seq: stepParts.seq,
        toolCallId: stepParts.toolCallId,
        toolName: stepParts.toolName,
        status: stepParts.status,
      })
      .from(stepParts)
      .where(inArray(stepParts.turnId, filteredTurnIds))
      .orderBy(stepParts.turnId, stepParts.seq)
      .all();

    // Group parts by turnId (already seq-ordered within each turn)
    const partsByTurnId = new Map<number, typeof partRows>();
    for (const p of partRows) {
      const list = partsByTurnId.get(p.turnId);
      if (list) {
        list.push(p);
      } else {
        partsByTurnId.set(p.turnId, [p]);
      }
    }

    const replayOpts: ReplayPartOptions = {
      includeTextParts: options.includeTextParts,
      includeTools: options.includeTools,
      includeReasoningParts: options.includeReasoningParts,
      includePatchParts: options.includePatchParts,
      includeOtherParts: options.includeOtherParts,
    };

    // 3. Build messages for each turn in order — step-faithful for live turns,
    //    summary carriers for summary turns.
    for (const turnId of filteredTurnIds) {
      const turn = turnById.get(turnId);
      if (!turn) continue;

      const parts = partsByTurnId.get(turnId) ?? [];

      if ((turn.kind ?? "turn") === "summary") {
        // Summary rows are reference context: NEVER the handoff prompt (the
        // row's userContent) and NEVER replayed as an assistant turn. Emit the
        // full summary text as a single labeled system message when text parts
        // are enabled and present; otherwise emit nothing (pending/failed rows).
        if (options.includeTextParts) {
          const summaryText = parts
            .filter((p) => p.type === "text")
            .map((p) => {
              const d = parsePartData(p.data);
              return typeof d.content === "string" ? d.content : "";
            })
            .join("");
          if (summaryText) messages.push(summaryCarrier(summaryText, rangeBySummaryTurn.get(turn.id)));
        }
        continue;
      }

      messages.push({
        role: "user",
        content: turn.userContent,
      });

      messages.push(...replayPartsToMessages(parts, replayOpts));
    }
  }

  // 4. Prepend system prompt once (only if it has content)
  const finalMessages: CoreMessage[] = [];
  if (systemBlock.trim()) {
    finalMessages.push({ role: "system", content: systemBlock });
  }
  finalMessages.push(...messages);

  // 5. Append current user message
  finalMessages.push({ role: "user", content: options.currentUserMessage });

  return {
    messages: finalMessages,
    contextTurnIds: filteredTurnIds,
    systemBlock,
  };
}
