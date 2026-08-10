import { z } from "zod";
import type { ToolDef } from "../types";
import type { AgentSettings } from "../../../../../_shared/types";

function buildAgentList(agents?: Record<string, AgentSettings>): string {
  if (!agents) return "(none)";
  const names = Object.keys(agents);
  if (names.length === 0) return "(none)";
  return names.map((n) => `- ${n}`).join("\n");
}

export function makeTaskTool(agents?: Record<string, AgentSettings>): ToolDef {
  const agentList = buildAgentList(agents);

  return {
    name: "task",
    description: `Delegate work to a subagent in its own session; you act as its user.
- Give a detailed prompt; the subagent runs the normal agent pipeline.
- You receive only its final assistant message (no tool traces).
- Result includes task_id; pass it again to continue that session.
- Wait for the result before dependent work; do not nest task calls.
- See skill:task for subagent semantics.

Available agent configs:
${agentList}`,
    permissionDefault: "ask",
    outputFields: [
      { name: "task_id", type: "string", description: "Subagent session task_id (pass to continue)", required: false },
      { name: "isError", type: "boolean", description: "Whether the subagent reported an error", required: false },
    ],
    inputSchema: z.object({
      agent_name: z.string().describe("Agent config to use"),
      description: z.string().describe("Short UI label"),
      prompt: z.string().describe("Full task for the subagent"),
      task_id: z
        .string()
        .optional()
        .describe("Prior task_id to resume that session"),
    }),
    execute: async (args, ctx) => {
      const { runSubagentTurn } = await import("../../subagents");
      const { recordSubagentSpawnEdge } = await import("../../subagents/db");

      const bridgePermission =
        ctx.bridgePermission ??
        (async (toolName: string, toolArgs: unknown, _callId: string) =>
          ctx.askPermission(toolName, toolArgs));

      const parentToolCallId = ctx.callId;
      const isResume = !!args.task_id?.trim();

      const result = await runSubagentTurn(
        {
          agentKey: args.agent_name,
          description: args.description,
          prompt: args.prompt,
          taskId: args.task_id,
        },
        {
          parent: ctx,
          parentSessionId: ctx.sessionId,
          workspaceRoot: ctx.workspaceRoot,
          dataDir: ctx.dataDir,
          abortSignal: ctx.abortSignal,
          bridgePermission,
          onToolCall: ctx.bridgeToolCall
            ? (e) => ctx.bridgeToolCall!({ ...e, parentToolCallId })
            : undefined,
          onToolResult: ctx.bridgeToolResult
            ? (e) => ctx.bridgeToolResult!({ ...e, parentToolCallId })
            : undefined,
          onToolUpdate: ctx.bridgeToolUpdate
            ? (e) => ctx.bridgeToolUpdate!({ ...e, parentToolCallId })
            : undefined,
          onSessionReady: ctx.bridgeToolUpdate
            ? (info) =>
                ctx.bridgeToolUpdate!({
                  toolCallId: ctx.callId,
                  status: "running",
                  taskId: info.sessionId,
                })
            : undefined,
        }
      );

      // Record edge whenever a child session id is known
      // (completed, cancelled, or error after session was created).
      const childSessionId = result.metadata.task_id?.trim();
      if (childSessionId) {
        recordSubagentSpawnEdge({
          parentSessionId: ctx.sessionId,
          toolCallId: ctx.callId,
          childSessionId,
          kind: isResume ? "resume" : "spawn",
          taskLabel: args.description ?? null,
          dataDir: ctx.dataDir,
        });
      }

      return {
        title: result.title,
        output: result.output,
        metadata: result.metadata,
        isError: result.isError,
      };
    },
  };
}

/** Static fallback when no agent config is available. */
export const taskTool: ToolDef = makeTaskTool();
