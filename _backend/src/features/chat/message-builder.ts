import { inArray, eq } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns, stepParts } from "../../db/schema";
import type { CoreMessage } from "ai";
import { normalizeToolInput } from "./tool-input";

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
  maxTurns?: number;
  currentTurnNumber: number;
  firstTurnNumber?: number | null; // slider position (firstTurnNumber from context config)
  currentUserMessage: string;
}

export interface BuildModelMessagesResult {
  messages: CoreMessage[];
  contextTurnIds: number[];
  systemBlock: string;
}

function parsePartData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data);
  } catch {
    return { content: data };
  }
}

/**
 * Reads a persisted `additional_system_info` injection (a `tool` stepPart with
 * `toolName: "additional_system_info"` and `data.kind === "system-info"` /
 * `data.additionalSystemInfo === true`). Returns the verbatim content and the
 * deterministic toolCallId so the fabricated call + result stay balanced.
 * `toolCallId` may come from the part column (persistence path) or `data`
 * (audit-friendly form). Returns null for normal tool parts.
 */
export function readAdditionalSystemInfoData(
  data: Record<string, unknown>,
  toolCallId?: string | null,
): { content: string; toolCallId: string } | null {
  if (!(data.additionalSystemInfo === true) && data.kind !== "system-info") return null;
  const content = typeof data.content === "string" ? data.content : "";
  const callId = typeof data.toolCallId === "string" ? data.toolCallId : toolCallId ?? "";
  if (!content || !callId) return null;
  return { content, toolCallId: callId };
}

export async function buildModelMessages(
  sessionId: string,
  systemBlock: string,
  options: BuildModelMessagesOptions,
  dataDir?: string,
): Promise<BuildModelMessagesResult> {
  const db = dbFor(dataDir);

  // NOTE: Summaries deliberately do NOT control normal-message context. The
  // context sent for a regular turn follows the circle (firstTurnNumber) and
  // always includes the relevant normal turns. Summaries are a separate display
  // layer that only informs how other summaries are produced (chaining via
  // prevRangeId); they never collapse or inject into live turn context here.

  // 1. Filter contextTurnIds by completion status and maxTurns
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
        .filter((t) => t.success === 1 && t.status === "success" && t.turnNumber < options.currentTurnNumber)
        .map((t) => t.id)
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
      turnRows.filter((t) => t.turnNumber < options.currentTurnNumber).map((t) => t.id)
    );

    filteredTurnIds = filteredTurnIds.filter((id) => validIds.has(id));
  }

  // 2. Fetch all turns and their stepParts in batch
  const messages: CoreMessage[] = [];

  if (filteredTurnIds.length > 0) {
    // Fetch turn metadata
    const turnRows = db
      .select({ id: turns.id, turnNumber: turns.turnNumber, userContent: turns.userContent, userTimestamp: turns.userTimestamp })
      .from(turns)
      .where(inArray(turns.id, filteredTurnIds))
      .orderBy(turns.turnNumber)
      .all();

    const turnById = new Map(turnRows.map((t) => [t.id, t]));

    // Fetch ALL stepParts for these turns in one query
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

    // Group parts by turnId
    const partsByTurnId = new Map<number, typeof partRows>();
    for (const p of partRows) {
      const list = partsByTurnId.get(p.turnId);
      if (list) {
        list.push(p);
      } else {
        partsByTurnId.set(p.turnId, [p]);
      }
    }

    // 3. Build messages for each turn in order
    for (const turnId of filteredTurnIds) {
      const turn = turnById.get(turnId);
      if (!turn) continue;

      // User message
      messages.push({
        role: "user",
        content: turn.userContent,
      });

      // Assistant message with multi-part content
      const parts = partsByTurnId.get(turnId) ?? [];
      const contentParts: CoreMessage["content"] = [];
      const toolResultMessages: CoreMessage[] = [];

      for (const part of parts) {
        const data = parsePartData(part.data);

        switch (part.type) {
          case "text": {
            if (options.includeTextParts) {
              const text = typeof data.content === "string" ? data.content : "";
              if (text) contentParts.push({ type: "text", text });
            }
            break;
          }
          case "tool": {
            const asi = readAdditionalSystemInfoData(data, part.toolCallId);
            if (asi) {
              if (options.includeTools === false) break; // hide injection when tools hidden
              contentParts.push({
                type: "tool-call",
                toolCallId: asi.toolCallId,
                toolName: "additional_system_info",
                input: {},
              });
              toolResultMessages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: asi.toolCallId,
                    toolName: "additional_system_info",
                    output: { type: "text", value: asi.content },
                  },
                ],
              });
              break;
            }
            if (options.includeTools && part.toolCallId) {
              // Guard: heal legacy rows whose `args` were persisted as a raw
              // malformed JSON string (SDK forwards the model's arguments
              // verbatim). Coerce to a plain object so the replayed request
              // keeps a valid `function.arguments` object on the wire.
              const args = normalizeToolInput(data.args);
              contentParts.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName ?? "",
                input: args,
              });
              const rawOutput = data.result ?? data.output ?? "";
              toolResultMessages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName ?? "",
                    output:
                      part.status === "completed"
                        ? { type: "text", value: typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) }
                        : { type: "error-text", value: `Tool call ${part.status} before returning a result` },
                  },
                ],
              });
            }
            break;
          }
          case "reasoning": {
            if (options.includeReasoningParts) {
              contentParts.push({
                type: "reasoning",
                text: typeof data.content === "string" ? data.content : "",
              });
            }
            break;
          }
          case "patch": {
            if (options.includePatchParts) {
              contentParts.push({
                type: "text",
                text: typeof data.patch === "string" ? data.patch : JSON.stringify(data.patch),
              });
            }
            break;
          }
          default: {
            if (options.includeOtherParts) {
              const text = typeof data.content === "string" ? data.content : JSON.stringify(data);
              if (text) contentParts.push({ type: "text", text });
            }
            break;
          }
        }
      }

      // Push assistant message if it has content parts
      if (contentParts.length > 0) {
        messages.push({ role: "assistant", content: contentParts });
      }

      // Push tool result messages
      messages.push(...toolResultMessages);
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
