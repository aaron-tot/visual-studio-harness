import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { getSessionMetaPublic } from "../../../storage/session";
import { listAgents } from "../../../rest/agents";
export const agentChangeTool: ToolDef = {
  name: "agent_change",
  description: `Request to switch to a different agent configuration. Use this when you believe a different agent (with different model/provider/settings) would be better suited for the current task. Provide your reasoning for the suggestion.`,
  permissionDefault: "ask",
  outputFields: [
    { name: "changed", type: "boolean", description: "Whether the agent was switched", required: true },
    { name: "from", type: "string", description: "Previous agent name", required: false },
    { name: "to", type: "string", description: "New agent name (only if changed)", required: false },
  ],
  inputSchema: z.object({
    suggestedAgent: z
      .string()
      .describe(
        "Name of the agent to switch to (e.g. 'main', 'sub', or a custom agent name)"
      ),
    reason: z
      .string()
      .describe("Why you think this agent would be better for the current task"),
    continueAfter: z
      .boolean()
      .optional()
      .describe(
        "Whether you recommend continuing immediately after the switch (true) or ending the turn (false/omit)"
      ),
  }),
  execute: async (args, ctx) => {
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

    if (!ctx.requestAgentChange) {
      return {
        title: "Agent change not available",
        output: "Agent change UI is not connected.",
        isError: true,
      };
    }

    const reply = await ctx.requestAgentChange({
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
    }
  },
};
