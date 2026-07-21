import { loadConfig } from "../../storage/config";
import { getSession } from "../../storage/session";
import { runTurn } from "../../agent/turn";
import { getAgentSettings, resolveRuntimeFromSettings } from "../../agent/runtime-settings";
import { withSubagentSlot } from "./concurrency";

import {
  ensureLlmSlotAvailable,
  normalizeSlotGateSettings,
} from "./slot-gate";
import type {
  SubagentSpawnArgs,
  SubagentSpawnContext,
  SubagentSpawnResult,
} from "./types";
import { formatLlmError, isAbortError } from "../../llm/errors";
import {
  AUTO_CONTINUE_MSG,
  AUTO_CONTINUE_THINKING_MSG,
  runAutoContinue,
  shouldAutoContinueOnTool,
  shouldAutoContinueOnThinking,
} from "../chat/auto-continue";

const SUMMARY_MAX = 12_000;

// Per-session attempt windows for subagent auto-continue (mirrors ws-chat.ts).
const subagentToolContinueAttempts = new Map<string, number[]>();
const subagentThinkingContinueAttempts = new Map<string, number[]>();

/**
 * Create or resume a child session and run one normal turn.
 * Uses the agent config identified by args.agentKey from config.agents.
 * Main agent is the user; subagent is the session agent.
 * Returns only the final assistant text for the parent tool result.
 */
export async function runSubagentTurn(
  args: SubagentSpawnArgs,
  ctx: SubagentSpawnContext
): Promise<SubagentSpawnResult> {
  const config = await loadConfig(ctx.dataDir);
  const parentMeta = await getSession(ctx.dataDir, ctx.parentSessionId);

  // v1: force serial
  const maxConcurrent = 1;

  return withSubagentSlot(maxConcurrent, async () => {
    const agentKey = (args.agentKey || "").trim();
    if (!agentKey) {
      return {
        title: args.description || "subagent",
        output: "ERROR task: agent_name is required",
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
        },
        isError: true,
      };
    }

    const description = (args.description || "subagent").trim() || "subagent";
    const prompt = (args.prompt || "").trim();
    if (!prompt) {
      return {
        title: description,
        output: "ERROR task: prompt is required",
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
        },
        isError: true,
      };
    }

    // Resolve provider+model from the agent file
    const { readAgent } = await import("../../rest/agents");
    const agentFile = await readAgent(ctx.dataDir, agentKey);
    if (!agentFile) {
      return {
        title: description,
        output: `ERROR task: agent '${agentKey}' not found`,
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
        },
        isError: true,
      };
    }
    const settings = getAgentSettings(agentFile, config);
    if (!settings.providerName || !settings.modelName) {
      return {
        title: description,
        output:
          `ERROR task: agent '${agentKey}' is not fully configured (missing provider or model). ` +
          "Configure it in Settings > Agents and retry.",
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
        },
        isError: true,
      };
    }

    const runtime = resolveRuntimeFromSettings(settings, config.providers);

    // Before nested LLM call: check local server parallel slots (llama.cpp /slots)
    const gateSettings = normalizeSlotGateSettings(settings);
    const slotRequestId = `slot-${ctx.parent.callId}`;
    const slotGate = await ensureLlmSlotAvailable({
      provider: runtime.provider,
      signal: ctx.abortSignal,
      settings: gateSettings,
      toolCallId: ctx.parent.callId,
      requestId: slotRequestId,
      askUser: ctx.parent.requestSlotBusyDecision
        ? async (info) => {
            return ctx.parent.requestSlotBusyDecision!({
              requestId: info.requestId,
              toolCallId: info.toolCallId,
              detail: info.probe.detail,
              free: info.probe.free,
              total: info.probe.total,
              modelAlias: info.probe.modelAlias,
              baseUrl: info.baseUrl,
              defaultPollIntervalSec: gateSettings.pollIntervalSec,
              defaultWaitTimeoutSec: gateSettings.waitTimeoutSec,
            });
          }
        : undefined,
      onStatus: (info) => {
        console.info("[subagent slot-gate]", info.message);
        ctx.parent.onSlotWaitStatus?.(info);
      },
      onWaitStart: (info) => {
        ctx.parent.onSlotWaitStart?.(info);
      },
      onWaitEnd: (info) => {
        ctx.parent.onSlotWaitEnd?.(info);
      },
    });
    if (!slotGate.ok) {
      return {
        title: description,
        output: `ERROR task: ${slotGate.error}`,
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
          providerName: runtime.provider.displayName,
          modelName: runtime.model.displayName,
        },
        isError: true,
      };
    }

    let childSessionId: string;
    let isNew = false;

    if (args.taskId?.trim()) {
      const existing = await getSession(ctx.dataDir, args.taskId.trim());
      if (!existing) {
        return {
          title: description,
          output: `ERROR task: unknown task_id '${args.taskId}'`,
          metadata: {
            task_id: args.taskId,
            status: "error",
            parentSessionId: ctx.parentSessionId,
          },
          isError: true,
        };
      }
      if (existing.meta.kind !== "subagent") {
        return {
          title: description,
          output: `ERROR task: session '${args.taskId}' is not a subagent session`,
          metadata: {
            task_id: args.taskId,
            status: "error",
            parentSessionId: ctx.parentSessionId,
          },
          isError: true,
        };
      }
      if (existing.meta.parentId !== ctx.parentSessionId) {
        return {
          title: description,
          output: `ERROR task: task_id does not belong to this parent session`,
          metadata: {
            task_id: args.taskId,
            status: "error",
            parentSessionId: ctx.parentSessionId,
          },
          isError: true,
        };
      }
      childSessionId = existing.meta.id;
    } else {
      isNew = true;
      childSessionId = "new";
    }

    try {
      let result = await runTurn(
        ctx.dataDir,
        config,
        {
          content: prompt,
          sessionId: childSessionId,
          workspaceRoot: ctx.workspaceRoot,
          excludeTools: ["task"],
          createMeta: isNew
            ? {
                kind: "subagent",
                parentId: ctx.parentSessionId,
                taskLabel: description,
                title: `Sub: ${description}`,
              }
            : undefined,
        },
        {
          source: "internal",
          signal: ctx.abortSignal,
          askPermission: ctx.bridgePermission
            ? (toolName, args, callId) => ctx.bridgePermission!(toolName, args, callId)
            : async () => true,
          onToolCall: ctx.onToolCall,
          onToolResult: ctx.onToolResult,
          onToolUpdate: ctx.onToolUpdate,
        }
      );

      // Auto-continue when the subagent ends on a tool call or reasoning block
      // (the eagent "wait, did you finish?" behavior), so it keeps working
      // instead of stopping mid-task. Without this the subagent turn never
      // passes through the auto-continue loop that only runs for WS turns.
      const childId = result.sessionId;
      const runCont = (content: string) =>
        runTurn(
          ctx.dataDir,
          config,
          {
            content,
            sessionId: childId,
            workspaceRoot: ctx.workspaceRoot,
            excludeTools: ["task"],
          },
          {
            source: "internal",
            signal: ctx.abortSignal,
            askPermission: ctx.bridgePermission
              ? (toolName, a, callId) => ctx.bridgePermission!(toolName, a, callId)
              : async () => true,
            onToolCall: ctx.onToolCall,
            onToolResult: ctx.onToolResult,
            onToolUpdate: ctx.onToolUpdate,
          }
        );

      let finalResult = result;
      if (config.autoContinueOnToolEnd) {
        finalResult = await runAutoContinue({
          sessionId: childId,
          initialResult: finalResult,
          attempts: subagentToolContinueAttempts,
          shouldContinue: shouldAutoContinueOnTool,
          maxAttempts: config.autoContinueOnToolEndMaxAttempts ?? 5,
          windowValue: config.autoContinueOnToolEndWindowValue ?? 1,
          windowUnit: config.autoContinueOnToolEndWindowUnit ?? "minutes",
          prompt: config.autoContinueOnToolEndPrompt ?? AUTO_CONTINUE_MSG,
          runTurn: runCont,
        });
      }
      if (config.autoContinueOnThinkingEnd) {
        finalResult = await runAutoContinue({
          sessionId: childId,
          initialResult: finalResult,
          attempts: subagentThinkingContinueAttempts,
          shouldContinue: shouldAutoContinueOnThinking,
          maxAttempts: config.autoContinueOnThinkingEndMaxAttempts ?? 5,
          windowValue: config.autoContinueOnThinkingEndWindowValue ?? 1,
          windowUnit: config.autoContinueOnThinkingEndWindowUnit ?? "minutes",
          prompt: config.autoContinueOnThinkingEndPrompt ?? AUTO_CONTINUE_THINKING_MSG,
          runTurn: runCont,
        });
      }
      result = finalResult;

      if (result.error) {
        return {
          title: description,
          output: `ERROR task: ${result.error}`,
          metadata: {
            task_id: result.sessionId,
            status: "error",
            parentSessionId: ctx.parentSessionId,
            providerName: runtime.provider.displayName,
            modelName: runtime.model.displayName,
          },
          isError: true,
        };
      }

      const text = (result.assistantMessage?.content || "").trim();
      const summary =
        (text || "(subagent returned empty final message)").slice(0, SUMMARY_MAX);

      const body = [
        summary,
        "",
        `task_id: ${result.sessionId}`,
        `agent: ${agentKey}`,
        `model: ${runtime.provider.displayName} / ${runtime.model.displayName}`,
        "(Pass task_id on a later task call to continue this subagent session.)",
      ].join("\n");

      return {
        title: description,
        output: body,
        metadata: {
          task_id: result.sessionId,
          status: "completed",
          parentSessionId: ctx.parentSessionId,
          providerName: runtime.provider.displayName,
          modelName: runtime.model.displayName,
          childTurnNumber: result.turnId,
        },
      };
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return {
          title: description,
          output: "ERROR task: cancelled",
          metadata: {
            task_id:
              typeof childSessionId === "string" && childSessionId !== "new"
                ? childSessionId
                : "",
            status: "cancelled",
            parentSessionId: ctx.parentSessionId,
          },
          isError: true,
        };
      }
      const message = formatLlmError(err, {
        provider: runtime.provider.displayName,
        model: runtime.model.displayName,
      });
      return {
        title: description,
        output: `ERROR task: ${message}`,
        metadata: {
          task_id: "",
          status: "error",
          parentSessionId: ctx.parentSessionId,
          providerName: runtime.provider.displayName,
          modelName: runtime.model.displayName,
        },
        isError: true,
      };
    }
  });
}
