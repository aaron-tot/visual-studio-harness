import type { WebSocket } from "ws";
import { broadcastToAll } from "../../ws/configPush";
import type { ConfigFile, SessionMeta, ThinkingEffort } from "../../../_shared/types";
import { runTurn } from "./run-turn";
import type { TurnEvents } from "./types";
import {
  sendToSession,
  sendSessionState,
  setActiveSession,
  getActiveSession,
} from "../sessions/view-tracker";
import {
  waitForPermission,
  cancelPermissionsForSession,
} from "../tools/permission-wait";
import { waitForSubagentConfig } from "../subagents/config-wait";
import { waitForSlotBusyDecision } from "../subagents/slot-busy-wait";
import { waitForAgentChange } from "../tools/agent-change-wait";
import { buildHookContext, getBus } from "../hooks";
import type { SessionAbortPayload } from "../hooks";
import { isAbortError } from "../../llm/errors";
import { updateSessionMeta } from "../sessions/store";
import type { TurnResult } from "./types";
import {
  AUTO_CONTINUE_MSG,
  AUTO_CONTINUE_THINKING_MSG,
  shouldAutoContinueOnTool,
  shouldAutoContinueOnThinking,
  runAutoContinue,
  runContinuationTurn,
} from "./auto-continue";
import { emitErrorAndDone, emitDoneOnly, classifyError } from "./error-delivery";
import { getSessionAborts, cancelSession, consumePendingContinue, wasUserCancelled, clearUserCancelled } from "./session-abort";
import { chatDebug } from "./debug";

const toolContinueAttempts = new Map<string, number[]>();
const thinkingContinueAttempts = new Map<string, number[]>();

// Guard against concurrent handleChatMessage invocations on the same socket.
// Prevents orphaned AbortControllers, double onClose listeners, and cancel
// targeting the wrong in-flight turn. See AUDIT_MEMORY_LEAKS.md finding #3.
const busySockets = new WeakSet<WebSocket>();

interface SessionUpdateWsMessage {
  sessionId: string;
  providerName?: string;
  modelName?: string;
  agentName?: string | null;
  thinkingEffort?: ThinkingEffort;
}

export async function handleSessionUpdate(msg: SessionUpdateWsMessage, dataDir: string, config: ConfigFile): Promise<SessionMeta> {
  const fields: Partial<SessionMeta> = {};
  if (msg.providerName !== undefined) fields.providerName = msg.providerName;
  if (msg.modelName !== undefined) fields.modelName = msg.modelName;
  if (msg.agentName !== undefined) fields.agentName = msg.agentName || undefined;
  if (msg.thinkingEffort !== undefined) fields.thinkingEffort = msg.thinkingEffort;
  if (Object.keys(fields).length === 0) throw new Error("session_update: no fields to update");
  return updateSessionMeta(dataDir, msg.sessionId, fields);
}

function streamWsHandlers(getSessionId: () => string): Pick<TurnEvents, "onToken" | "onReasoning" | "onToolCall" | "onToolResult" | "onToolUpdate"> {
  return {
    onToken: (token, seq) => { const sid = getSessionId(); sendToSession(sid, { type: "token", sessionId: sid, content: token, seq }); },
    onReasoning: (delta, seq) => { const sid = getSessionId(); sendToSession(sid, { type: "reasoning", sessionId: sid, content: delta, seq }); },
    onToolCall: (e) => { const sid = getSessionId(); sendToSession(sid, { type: "tool_start", sessionId: sid, toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, ...(e.seq != null ? { seq: e.seq } : {}), ...(e.parentToolCallId ? { parentToolCallId: e.parentToolCallId } : {}) }); },
    onToolResult: (e) => { const sid = getSessionId(); sendToSession(sid, { type: "tool_end", sessionId: sid, toolCallId: e.toolCallId, status: e.isError ? "error" : "completed", result: e.output, error: e.isError ? String(e.output) : undefined, ...(e.seq != null ? { seq: e.seq } : {}) }); },
    onToolUpdate: (e) => { const sid = getSessionId(); sendToSession(sid, { type: "tool_update", sessionId: sid, toolCallId: e.toolCallId, status: e.status, ...(e.seq != null ? { seq: e.seq } : {}) }); },
  };
}

export async function handleChatMessage(socket: WebSocket, msg: any, dataDir: string, config: ConfigFile) {
  // Reject concurrent turns on the same socket — prevents orphaned AbortControllers,
  // double onClose listeners, and cancel targeting the wrong in-flight turn.
  if (busySockets.has(socket)) {
    console.warn("handleChatMessage: socket already busy, rejecting concurrent turn");
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", error: "A chat session is already in progress. Cancel it first or wait for it to complete." }));
    return;
  }
  busySockets.add(socket);

  const abortController = new AbortController();
  const sessionAborts = getSessionAborts();

  console.log("tmpDebug: handleChatMessage ENTERED", { sessionId: msg.sessionId, contentLen: msg.content?.length, agentName: msg.agentName, providerName: msg.providerName, modelName: msg.modelName });
  const onClose = () => {
    abortController.abort();
    if (sessionId) cancelPermissionsForSession(sessionId);
  };
  socket.on("close", onClose);

  let sessionId = msg.sessionId && msg.sessionId !== "new" ? msg.sessionId : "";
  if (sessionId) sessionAborts.set(sessionId, abortController);
  const getSid = () => sessionId;
  const handlers = streamWsHandlers(getSid);

  let streamAnnounced = false;
  let streamSuccess = true;
  const announceStreamStart = () => {
    if (!sessionId) return;
    streamAnnounced = true;
    broadcastToAll({ type: "session_stream_start", sessionId });
  };
  const announceStreamEnd = (success: boolean) => {
    if (!streamAnnounced || !sessionId) return;
    broadcastToAll({ type: "session_stream_end", sessionId, success });
  };

  if (sessionId) {
    clearUserCancelled(sessionId);
    const active = getActiveSession(socket);
    if (!active || active === sessionId) setActiveSession(socket, sessionId);
  }

  try {
    console.log("tmpDebug: calling runTurn ...", { contentLen: msg.content?.length });
    let result = await runTurn(dataDir, config, {
      content: msg.content, sessionId: msg.sessionId, workspaceRoot: msg.workspaceRoot,
      agentName: msg.agentName ?? undefined, providerName: msg.providerName,
      modelName: msg.modelName, thinkingEffort: msg.thinkingEffort, noSystemPrompt: !msg.agentName,
    }, {
      source: "ws", signal: abortController.signal,
      onSessionReady: ({ sessionId: id, created, meta }) => {
        sessionId = id; sessionAborts.set(id, abortController);
        announceStreamStart();
        const active = getActiveSession(socket);
        if (created || !active || active === id) setActiveSession(socket, id);
        chatDebug("handleChatMessage", "session ready", { id, created, hadActive: active, activeNow: getActiveSession(socket) });
        if (created && socket.readyState === 1) socket.send(JSON.stringify({ type: "session_created", session: meta }));
        if (getActiveSession(socket) === id) sendSessionState(socket, id);
      },
      ...handlers,
      askPermission: async (toolName, args, callId) => {
        sendToSession(sessionId, { type: "permission_request", sessionId, toolCallId: callId, toolName, args });
        sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: callId, status: "awaiting_permission" });
        const ok = await waitForPermission(callId);
        sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: callId, status: ok ? "running" : "error" });
        return ok;
      },
      requestSubagentConfig: async (req) => {
        sendToSession(sessionId, { type: "subagent_config_request", sessionId, requestId: req.requestId, toolCallId: req.toolCallId, reason: req.reason, suggestedProvider: req.suggestedProvider, suggestedModel: req.suggestedModel });
        if (req.toolCallId) sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: req.toolCallId, status: "awaiting_config" });
        return waitForSubagentConfig(req.requestId);
      },
      requestSlotBusyDecision: async (req) => {
        sendToSession(sessionId, { type: "slot_busy_request", sessionId, requestId: req.requestId, toolCallId: req.toolCallId, detail: req.detail, free: req.free, total: req.total, modelAlias: req.modelAlias, baseUrl: req.baseUrl, defaultPollIntervalSec: req.defaultPollIntervalSec, defaultWaitTimeoutSec: req.defaultWaitTimeoutSec });
        if (req.toolCallId) sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: req.toolCallId, status: "awaiting_config" });
        return waitForSlotBusyDecision(req.requestId);
      },
      requestAgentChange: async (req) => {
        sendToSession(sessionId, { type: "agent_change_request", sessionId, requestId: req.requestId, toolCallId: req.toolCallId, suggestedAgent: req.suggestedAgent, reason: req.reason, agents: req.agents });
        if (req.toolCallId) sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: req.toolCallId, status: "awaiting_agent_change" });
        return waitForAgentChange(req.requestId);
      },
      abortTurn: () => cancelSession(sessionId, dataDir),
      onSlotWaitStart: (info) => {
        sendToSession(sessionId, { type: "slot_wait_started", sessionId, requestId: info.requestId, toolCallId: info.toolCallId, detail: info.detail, free: info.free, total: info.total, modelAlias: info.modelAlias, pollIntervalSec: info.pollIntervalSec, waitTimeoutSec: info.waitTimeoutSec });
        if (info.toolCallId) sendToSession(sessionId, { type: "tool_update", sessionId, toolCallId: info.toolCallId, status: "awaiting_config" });
      },
      onSlotWaitStatus: (info) => { sendToSession(sessionId, { type: "slot_wait_status", sessionId, requestId: info.requestId, message: info.message }); },
      onSlotWaitEnd: (info) => { sendToSession(sessionId, { type: "slot_wait_ended", sessionId, requestId: info.requestId }); },
    });

    // Always deliver done directly to the originating socket so the frontend
    // never hangs on "Thinking". Only deliver the error event when there is
    // actually an error — sending an empty {type:"error"} would cause the
    // frontend to show "Unknown error" for successful turns.
    if (result.error) {
      emitErrorAndDone(socket, result.sessionId, {
        error: result.error,
        rawError: result.rawError,
        errorIsCustom: result.errorIsCustom,
        category: "streaming",
      });
    } else {
      emitDoneOnly(socket, result.sessionId);
    }

    if (!wasUserCancelled(sessionId) && config.autoContinueOnToolEnd) {
      result = await runAutoContinue({
        sessionId,
        initialResult: result,
        attempts: toolContinueAttempts,
        shouldContinue: shouldAutoContinueOnTool,
        maxAttempts: config.autoContinueOnToolEndMaxAttempts ?? 5,
        windowValue: config.autoContinueOnToolEndWindowValue ?? 1,
        windowUnit: config.autoContinueOnToolEndWindowUnit ?? "minutes",
        prompt: config.autoContinueOnToolEndPrompt ?? AUTO_CONTINUE_MSG,
        runTurn: (content) =>
          runContinuationTurn({ dataDir, config, sessionId, content, streamHandlers: handlers, sessionAborts, cancelSession, socket }),
        isCancelled: () => wasUserCancelled(sessionId),
      });
    }

    if (!wasUserCancelled(sessionId) && config.autoContinueOnThinkingEnd) {
      result = await runAutoContinue({
        sessionId,
        initialResult: result,
        attempts: thinkingContinueAttempts,
        shouldContinue: shouldAutoContinueOnThinking,
        maxAttempts: config.autoContinueOnThinkingEndMaxAttempts ?? 5,
        windowValue: config.autoContinueOnThinkingEndWindowValue ?? 1,
        windowUnit: config.autoContinueOnThinkingEndWindowUnit ?? "minutes",
        prompt: config.autoContinueOnThinkingEndPrompt ?? AUTO_CONTINUE_THINKING_MSG,
        runTurn: (content) =>
          runContinuationTurn({ dataDir, config, sessionId, content, streamHandlers: handlers, sessionAborts, cancelSession, socket }),
        isCancelled: () => wasUserCancelled(sessionId),
      });
    }

    const continued = consumePendingContinue(sessionId);
    if (continued && !wasUserCancelled(sessionId)) await runContinuationTurn({ dataDir, config, sessionId, content: continued.content, agentName: continued.agentName, streamHandlers: handlers, sessionAborts, cancelSession, socket });
  } catch (err: unknown) {
    streamSuccess = false;
    const effectiveSessionId = sessionId || msg.sessionId || "new";
    console.log("tmpDebug: catch block", { effectiveSessionId, err: err instanceof Error ? err.message : String(err), isAbort: isAbortError(err) });
    if (!isAbortError(err)) {
      const info = classifyError(err, {
        provider: msg.providerName,
        model: msg.modelName,
      });
      // Send directly to the originating socket — always guaranteed safe.
      emitErrorAndDone(socket, effectiveSessionId, info);
    } else {
      // For abort errors, still send done so the frontend un-sticks
      emitDoneOnly(socket, effectiveSessionId);
    }
  } finally {
    announceStreamEnd(streamSuccess);
    socket.removeListener("close", onClose);
    if (sessionId) sessionAborts.delete(sessionId);
    busySockets.delete(socket);
  }
}
