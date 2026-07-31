import { eq, and, inArray, desc } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns, stepParts } from "../../db/schema";
import type { CoreMessage } from "ai";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

export interface BuildModelMessagesOptions {
  contextTurnIds: number[];
  includeIncompleteTurns: boolean;
  includeTextParts: boolean;
  includeToolCalls: boolean;
  includeToolResults: boolean;
  includeReasoningParts: boolean;
  includePatchParts: boolean;
  includeOtherParts: boolean;
  maxTurns?: number;
  currentTurnNumber: number;
  currentUserMessage: string;
}

export interface BuildModelMessagesResult {
  messages: CoreMessage[];
  contextTurnIds: number[];
  systemBlock: string;
}

interface StepPartRow {
  turnId: number;
  type: string;
  data: string;
  seq: number;
  toolCallId: string | null;
  toolName: string | null;
  status: string | null;
}

interface TurnRow {
  id: number;
  turnNumber: number;
  userContent: string;
  userTimestamp: string;
  status: string;
  success: number | null;
}

function parsePartData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data);
  } catch {
    return { content: data };
  }
}

function isTurnCompleted(turn: TurnRow, includeIncomplete: boolean): boolean {
  if (includeIncomplete) return true;
  return turn.success === 1 && turn.status === "success";
}

export async function buildModelMessages(
  sessionId: string,
  systemBlock: string,
  options: BuildModelMessagesOptions,
  dataDir?: string,
): Promise<BuildModelMessagesResult> {
  const db = dbFor(dataDir);

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

  // Apply maxTurns (slice from end to keep most recent)
  if (options.maxTurns && filteredTurnIds.length > options.maxTurns) {
    filteredTurnIds = filteredTurnIds.slice(-options.maxTurns);
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
            if (part.status === "running" && options.includeToolCalls) {
              contentParts.push({
                type: "tool-call",
                toolCallId: part.toolCallId ?? "",
                toolName: part.toolName ?? "",
                args: data.args ?? {},
              });
            } else if (part.status === "completed" && options.includeToolResults) {
              toolResultMessages.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: part.toolCallId ?? "",
                    toolName: part.toolName ?? "",
                    result: data.result ?? data.output ?? "",
                    isError: part.status === "error",
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
                signature: data.signature,
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
