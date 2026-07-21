import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { handleChatMessage, handleSessionUpdate } from "../features/chat/ws-chat";
import { cancelSession, setPendingContinue, consumePendingContinue, clearPendingContinue } from "../features/chat/session-abort";
import { registerConnection } from "../ws/configPush";
import { setActiveSession, clearActiveSession, sendSessionState, sendSessionStateToSession } from "../features/sessions/view-tracker";
import { resolvePermission } from "../features/tools/permission-wait";
import { resolveSubagentConfig } from "../features/subagents/config-wait";
import { resolveSlotBusyDecision } from "../features/subagents/slot-busy-wait";
import { forceSlotWaitTimeout } from "../features/subagents/slot-wait-control";
import { resolveAgentChange } from "../features/tools/agent-change-wait";
import { setToolMode } from "../features/tools/perms/store";
import { getSessionMetaPublic } from "../features/sessions/store";
import type { PermissionDecision, PermissionMode, PermsLayer, ThinkingEffort } from "../../../_shared/types";

type GetDataDir = () => string;
type GetConfig = () => import("../../../_shared/types").ConfigFile;

const connections = new Set<WebSocket>();

function broadcast(payload: unknown): void {
  const msg = JSON.stringify(payload);
  console.log("Backend received payload: ",payload)
  for (const socket of connections) {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(msg); } catch {}
    }
  }
}

const DECISIONS = new Set<PermissionDecision>([
  "deny",
  "approve",
  "approve_session",
  "deny_session",
  "approve_workspace",
  "deny_workspace",
  "approve_global",
  "deny_global",
]);

function parseDecision(msg: {
  decision?: string;
  approved?: boolean;
}): PermissionDecision {
  if (msg.decision && DECISIONS.has(msg.decision as PermissionDecision)) {
    return msg.decision as PermissionDecision;
  }
  // legacy boolean
  if (msg.approved === true) return "approve";
  return "deny";
}

function decisionToApproved(d: PermissionDecision): boolean {
  return d === "approve" || d.startsWith("approve_");
}

function decisionToLayerWrite(
  d: PermissionDecision
): { layer: PermsLayer; mode: PermissionMode } | null {
  switch (d) {
    case "approve_session":
      return { layer: "session", mode: "allow" };
    case "deny_session":
      return { layer: "session", mode: "deny" };
    case "approve_workspace":
      return { layer: "workspace", mode: "allow" };
    case "deny_workspace":
      return { layer: "workspace", mode: "deny" };
    case "approve_global":
      return { layer: "global", mode: "allow" };
    case "deny_global":
      return { layer: "global", mode: "deny" };
    default:
      return null;
  }
}

export function registerWsHandler(
  app: FastifyInstance,
  getDataDir: GetDataDir,
  getConfig: GetConfig
) {
  app.get("/chat", { websocket: true }, (socket: WebSocket) => {
    connections.add(socket);
    registerConnection(socket);
    console.log(`WebSocket connected (${connections.size} total)`);

    socket.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "chat") {
          const sessionId = msg.sessionId && msg.sessionId !== "new" ? msg.sessionId : "";
          if (sessionId) {
            setActiveSession(socket, sessionId);
          }
          handleChatMessage(socket, msg, getDataDir(), getConfig()).catch((err) => console.error("[WS] handleChatMessage error:", err instanceof Error ? err.stack : err));
        } else if (msg.type === "permission_response") {
          const decision = parseDecision(msg);
          const approved = decisionToApproved(decision);
          const write = decisionToLayerWrite(decision);
          const dataDir = getDataDir();
          const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
          const toolName = typeof msg.toolName === "string" ? msg.toolName : "";

          if (write) {
            try {
              let workspaceRoot: string | undefined;
              if (write.layer === "workspace" || write.layer === "session") {
                if (sessionId) {
                  const meta = await getSessionMetaPublic(dataDir, sessionId);
                  workspaceRoot = meta?.workspaceRoot;
                }
              }
              if (write.layer === "workspace" && !workspaceRoot?.trim()) {
                console.error("permission_response: no workspaceRoot for workspace write");
                resolvePermission(msg.toolCallId, false);
                return;
              }
              if (!toolName) {
                console.error("permission_response: toolName required for persistent decision");
                resolvePermission(msg.toolCallId, false);
                return;
              }
              await setToolMode({
                layer: write.layer,
                dataDir,
                sessionId: sessionId || undefined,
                workspaceRoot,
                toolName,
                mode: write.mode,
              });
            } catch (err) {
              console.error("permission_response write failed:", err);
              resolvePermission(msg.toolCallId, false);
              return;
            }
          }

          resolvePermission(msg.toolCallId, approved);
        } else if (msg.type === "subagent_config_response") {
          const action =
            msg.action === "once" || msg.action === "global" || msg.action === "cancel"
              ? msg.action
              : "cancel";
          const effort = msg.thinkingEffort as ThinkingEffort | undefined;
          resolveSubagentConfig(String(msg.requestId || ""), {
            action,
            providerName: typeof msg.providerName === "string" ? msg.providerName : undefined,
            modelName: typeof msg.modelName === "string" ? msg.modelName : undefined,
            temperature:
              typeof msg.temperature === "number" ? msg.temperature : undefined,
            thinkingEffort:
              effort === "off" ||
              effort === "low" ||
              effort === "medium" ||
              effort === "high"
                ? effort
                : undefined,
            maxSteps: typeof msg.maxSteps === "number" ? msg.maxSteps : undefined,
          });
        } else if (msg.type === "slot_busy_response") {
          const action =
            msg.action === "wait" || msg.action === "fail" || msg.action === "cancel"
              ? msg.action
              : "cancel";
          resolveSlotBusyDecision(String(msg.requestId || ""), {
            action,
            pollIntervalSec:
              typeof msg.pollIntervalSec === "number" ? msg.pollIntervalSec : undefined,
            waitTimeoutSec:
              typeof msg.waitTimeoutSec === "number" ? msg.waitTimeoutSec : undefined,
          });
        } else if (msg.type === "slot_wait_abort") {
          forceSlotWaitTimeout(String(msg.requestId || ""));
        } else if (msg.type === "agent_change_response") {
          const action =
            msg.action === "switch" || msg.action === "switch_continue" || msg.action === "continue" || msg.action === "stop"
              ? msg.action
              : "stop";
          resolveAgentChange(String(msg.requestId || ""), {
            action,
            agentName: typeof msg.agentName === "string" ? msg.agentName : undefined,
          });
          if (action === "switch_continue" && msg.continueMessage) {
            setPendingContinue(String(msg.sessionId || ""), {
              content: msg.continueMessage.content,
              agentName: msg.continueMessage.agentName,
            });
          }
        } else if (msg.type === "cancel") {
          if (msg.sessionId) cancelSession(msg.sessionId, getDataDir());
        } else if (msg.type === "request_session_state") {
          if (msg.sessionId) {
            setActiveSession(socket, msg.sessionId);
            // Reply on this socket with optional requestId so the client can
            // drop stale responses from rapid session switches.
            const requestId =
              typeof msg.requestId === "number" ? msg.requestId : undefined;
            sendSessionState(socket, msg.sessionId, requestId);
          }
        } else if (msg.type === "session_update") {
          const updatedMeta = await handleSessionUpdate(msg, getDataDir(), getConfig());
          broadcast({ type: "session_updated", session: updatedMeta });
        }
      } catch (err) {
        console.error("WS message error:", err);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "error", error: "Invalid message" }));
        }
      }
    });

    socket.on("close", () => {
      connections.delete(socket);
      clearActiveSession(socket);
      console.log(`WebSocket disconnected (${connections.size} total)`);
    });

    socket.on("error", (err) => {
      console.error("WS error:", err);
      connections.delete(socket);
      clearActiveSession(socket);
    });
  });
}

export { setPendingContinue, consumePendingContinue, clearPendingContinue };
