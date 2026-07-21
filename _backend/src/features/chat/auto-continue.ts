/**
 * Auto-continue policy + shared run helper for tool/thinking/switch_continue.
 * Keeps ws/chat.ts from copy-pasting permission + stream wiring three times.
 */
import type WebSocket from "ws";
import type { ConfigFile, MessagePartType } from "../../../../_shared/types";
import { runTurn, type TurnResult } from "./run-turn";
import { sendSessionStateToSession, sendToSession } from "../sessions/view-tracker";
import { waitForPermission } from "../tools/permission-wait";
import { classifyLlmError, isAbortError } from "../../llm/errors";
import { emitErrorAndDone, emitDoneOnly } from "./error-delivery";

export const AUTO_CONTINUE_MSG =
  "<system>It was detected that you ended on a tool call without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>";
export const AUTO_CONTINUE_THINKING_MSG =
  "<system>It was detected that you ended on a reasoning block without sending a final response. Did you finish your task? Check the previous messages and any active TODO list. If you're done, update the TODO list to reflect that and inform the user. If not, update the TODO list if needed, then continue working from the next relevant task.</system>";

const WINDOW_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
};

export function canAutoContinue(
  map: Map<string, number[]>,
  key: string,
  maxAttempts: number,
  windowValue: number,
  windowUnit: "seconds" | "minutes" | "hours"
): boolean {
  const windowMs = windowValue * (WINDOW_MS[windowUnit] ?? 60000);
  const now = Date.now();
  let attempts = map.get(key) ?? [];
  attempts = attempts.filter((t) => now - t < windowMs);
  if (attempts.length === 0) {
    map.delete(key);
    return true;
  }
  map.set(key, attempts);
  return attempts.length < maxAttempts;
}

export function recordAutoContinue(map: Map<string, number[]>, key: string): void {
  const attempts = map.get(key) ?? [];
  attempts.push(Date.now());
  map.set(key, attempts);
}

export function shouldAutoContinueOnTool(result: {
  success?: boolean;
  assistantMessage?: { parts?: MessagePartType[] } | null;
}): boolean {
  if (!result.success) return false;
  if (!result.assistantMessage?.parts?.length) return false;
  const parts = result.assistantMessage.parts;
  const lastPart = parts[parts.length - 1];
  if (lastPart.type !== "tool") return false;
  const lastToolIdx = parts.findLastIndex((p) => p.type === "tool");
  const hasTextAfter = parts.slice(lastToolIdx + 1).some((p) => p.type === "text");
  return !hasTextAfter;
}

export function shouldAutoContinueOnThinking(result: {
  success?: boolean;
  assistantMessage?: { parts?: MessagePartType[] } | null;
}): boolean {
  if (!result.success) return false;
  if (!result.assistantMessage?.parts?.length) return false;
  const parts = result.assistantMessage.parts;
  const lastPart = parts[parts.length - 1];
  return lastPart.type === "reasoning";
}

export interface AutoContinueLoopOptions {
  sessionId: string;
  initialResult: TurnResult;
  attempts: Map<string, number[]>;
  shouldContinue: (r: TurnResult) => boolean;
  maxAttempts: number;
  windowValue: number;
  windowUnit: "seconds" | "minutes" | "hours";
  prompt: string;
  runTurn: (content: string) => Promise<TurnResult | null>;
  /** Returns true when the user explicitly stopped the turn (e.g. pressed Stop). */
  isCancelled?: () => boolean;
}

/**
 * Loops continuation turns while `shouldContinue` is true and the per-window
 * attempt cap is not exceeded. Used by both the primary WS turn (ws-chat.ts)
 * and subagent turns (spawn.ts) so auto-continue behaves identically everywhere.
 */
export async function runAutoContinue(opts: AutoContinueLoopOptions): Promise<TurnResult> {
  let contResult = opts.initialResult;
  while (opts.shouldContinue(contResult)) {
    if (opts.isCancelled?.()) break;
    if (!canAutoContinue(opts.attempts, opts.sessionId, opts.maxAttempts, opts.windowValue, opts.windowUnit)) break;
    recordAutoContinue(opts.attempts, opts.sessionId);
    const next = await opts.runTurn(opts.prompt);
    if (!next) break;
    contResult = next;
  }
  return contResult;
}

/** Shared continuation turn: permissions + stream handlers + error/done. */
export async function runContinuationTurn(opts: {
  dataDir: string;
  config: ConfigFile;
  sessionId: string;
  content: string;
  agentName?: string;
  /** streamWsHandlers(...) result */
  streamHandlers: Record<string, unknown>;
  sessionAborts: Map<string, AbortController>;
  cancelSession: (sessionId: string, dataDir?: string) => void;
  /** Originating WebSocket for guaranteed error delivery. */
  socket?: WebSocket;
}): Promise<TurnResult | null> {
  const {
    dataDir,
    config,
    sessionId,
    content,
    agentName,
    streamHandlers,
    sessionAborts,
    cancelSession,
    socket,
  } = opts;
  const acAbort = new AbortController();
  // Abort any stale controller for this session so no orphaned AbortControllers accumulate
  const prev = sessionAborts.get(sessionId);
  if (prev) prev.abort();
  sessionAborts.set(sessionId, acAbort);
  try {
    const contResult = await runTurn(
      dataDir,
      config,
      {
        sessionId,
        content,
        ...(agentName !== undefined ? { agentName } : {}),
        noSystemPrompt: false,
      },
      {
        source: "ws",
        signal: acAbort.signal,
        onSessionReady: () => {
          sendSessionStateToSession(sessionId);
        },
        ...streamHandlers,
        askPermission: async (toolName: string, args: unknown, callId: string) => {
          sendToSession(sessionId, {
            type: "permission_request",
            sessionId,
            toolCallId: callId,
            toolName,
            args,
          });
          sendToSession(sessionId, {
            type: "tool_update",
            sessionId,
            toolCallId: callId,
            status: "awaiting_permission",
          });
          const ok = await waitForPermission(callId);
          sendToSession(sessionId, {
            type: "tool_update",
            sessionId,
            toolCallId: callId,
            status: ok ? "running" : "error",
          });
          return ok;
        },
        abortTurn: () => {
          cancelSession(sessionId, dataDir);
        },
      }
    );
    if (contResult.error) {
      if (socket) {
        emitErrorAndDone(socket, contResult.sessionId || sessionId, {
          error: contResult.error,
          rawError: contResult.rawError,
          errorIsCustom: contResult.errorIsCustom,
          category: "streaming",
        });
      } else {
        sendToSession(sessionId, {
          type: "error",
          sessionId: contResult.sessionId || sessionId,
          error: contResult.error,
          rawError: contResult.rawError,
          errorIsCustom: contResult.errorIsCustom,
        });
      }
    }
    return contResult;
  } catch (err) {
    if (!isAbortError(err)) {
      const info = classifyLlmError(err);
      if (socket) {
        emitErrorAndDone(socket, sessionId, {
          error: info.message,
          rawError: info.isCustom ? info.raw : undefined,
          errorIsCustom: info.isCustom,
          category: "streaming",
        });
      } else {
        sendToSession(sessionId, {
          type: "error",
          sessionId,
          error: info.message,
          rawError: info.isCustom ? info.raw : undefined,
          errorIsCustom: info.isCustom,
        });
      }
    } else if (socket) {
      emitDoneOnly(socket, sessionId);
    }
    return null;
  }
}
