/**
 * Builtin `agent_change` tool — self-contained ctx entry.
 * Reads the canonical agent list via ctx.services.listAgents, determines the
 * current agent via ctx.services.getSessionMetaPublic, and prompts the user to
 * switch through the ctx.requestAgentChange callback (present on the runtime
 * ExtendedToolContext).
 */
export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
  _stopTurn?: boolean;
}> {
  // Read agents from data/{mode}/agents/*.json (the canonical agent list).
  const fileAgents = await ctx.services.listAgents();

  let currentAgent = "main";
  try {
    const meta = await ctx.services.getSessionMetaPublic(ctx.sessionId);
    if (meta?.kind === "subagent") {
      currentAgent = "sub";
    }
  } catch {
    // default to "main"
  }

  const agentList = fileAgents.map((fa: { key: string }) => ({
    name: fa.key,
    isCurrent: fa.key === currentAgent,
  }));

  if (agentList.length <= 1) {
    return {
      title: "No other agents available",
      output: "Only one agent configuration exists. Cannot suggest a change.",
      isError: true,
    };
  }

  if (typeof ctx.requestAgentChange !== "function") {
    return {
      title: "Agent change not available",
      output: "Agent change UI is not connected.",
      isError: true,
    };
  }

  const reply = await ctx.requestAgentChange({
    requestId: ctx.callId,
    toolCallId: ctx.callId,
    suggestedAgent: String(args.suggestedAgent ?? ""),
    reason: String(args.reason ?? ""),
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
        output: "User declined the agent change. Continue with the current agent.",
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
        title: "Agent change",
        output: `Unknown agent change reply action: "${String(reply?.action)}"`,
        isError: true,
      };
  }
}
