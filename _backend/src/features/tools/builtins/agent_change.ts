import { z } from "zod";
import type { ExtendedToolContext, ToolDef, ToolFieldDef } from "../types";
import { getSessionMetaPublic } from "../../../storage/session";
import { listAgents } from "../../../rest/agents";
export const agentChangeTool: ToolDef = {
  name: "agent_change",
  description: "Request to switch to a different agent configuration.",
  permissionDefault: "ask",
  outputFields: [
    { name: "changed", type: "boolean", description: "Whether the agent was switched", required: true },
    { name: "from", type: "string", description: "Previous agent name", required: false },
    { name: "to", type: "string", description: "New agent name (only if changed)", required: false },
  ],
  inputSchema: z.object({
    suggestedAgent: z.string().describe("Agent to switch to"),
    reason: z.string().describe("Why this agent is better"),
    continueAfter: z.boolean().optional().describe("Continue immediately after switch"),
  }),
  execute: async (args, ctx) => {
    const tctx = ctx as ExtendedToolContext;
    // Read agents from data/{mode}/agents/*.json (the canonical agent list)
    const fileAgents = await listAgents(ctx.dataDir);

    let currentAgent = "main";
    try {
      const meta = await getSessionMetaPublic(ctx.dataDir, ctx.sessionId);
      if (meta?.kind === "subagent") {
        currentAgent = "sub";
      }
    } catch {
      // default to "main"
    }

    const agentList = fileAgents.map((fa) => ({
      name: fa.key,
      isCurrent: fa.key === currentAgent,
    }));

    if (agentList.length <= 1) {
      return {
        title: "No other agents available",
        output:
          "Only one agent configuration exists. Cannot suggest a change.",
        isError: true,
      };
    }

    if (!tctx.requestAgentChange) {
      return {
        title: "Agent change not available",
        output: "Agent change UI is not connected.",
        isError: true,
      };
    }

    const reply = await tctx.requestAgentChange({
      requestId: ctx.callId,
      toolCallId: ctx.callId,
      suggestedAgent: args.suggestedAgent,
      reason: args.reason,
      agents: agentList,
      suggestedAction: args.continueAfter ? "continue" : "end_turn",
    });

    switch (reply.action) {
      case "switch":
      case "switch_continue":
        return {
          title: "Agent change accepted",
          output: `User accepted switch to "${reply.agentName}". Turn ended.`,
          metadata: { switched: true, targetAgent: reply.agentName },
          _stopTurn: true,
        };
      case "continue":
        return {
          title: "Agent change declined",
          output:
            "User declined the agent change. Continue with the current agent.",
          metadata: { switched: false },
        };
      case "stop":

        return {
          title: "Turn stopped",
          output: "User chose to stop the turn.",
          metadata: { stopped: true },
          _stopTurn: true,
        };
      default:
        return {
          title: "Agent change not applied",
          output: `Unhandled reply action: ${(reply as { action?: string }).action ?? "unknown"}`,
          isError: true,
        };
    }
  },
};
