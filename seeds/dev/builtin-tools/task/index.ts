/**
 * Builtin `task` tool — self-contained ctx entry (pass-through bridge).
 *
 * The original task tool calls `runSubagentTurn` from the harness internals,
 * which a data-folder entry cannot import. Instead this entry reads the
 * ExtendedToolContext fields that exist on `ctx` at runtime (bridgePermission,
 * bridgeToolCall/Result/Update, callId, sessionId, ...) and delegates the heavy
 * lifting to a subagent bridge that the harness wires onto `ctx.subagent`.
 *
 * ASSUMED bridge shape (checked at runtime, entry types are loose):
 *   ctx.subagent.runTurn | ctx.subagent.runSubagentTurn | ctx.runSubagentTurn
 *   -> (opts: {
 *        agentKey, description, prompt, taskId,
 *        parent, parentSessionId, workspaceRoot, dataDir, abortSignal,
 *        bridgePermission, onToolCall, onToolResult, onToolUpdate
 *      }) => Promise<{ title, output, metadata?, isError? }>
 *
 * If no bridge is present, returns a graceful error result instead of throwing
 * or dispatching a real subagent. `recordSubagentSpawnEdge` (spawn graph edge)
 * is intentionally NOT called by the entry — the harness bridge owns that.
 */
export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const agentName = String(args.agent_name ?? "").trim();
  const description = String(args.description ?? "").trim();
  const prompt = String(args.prompt ?? "").trim();

  if (!agentName || !description || !prompt) {
    return {
      title: "task",
      output: "ERROR task: agent_name, description, and prompt are required",
      isError: true,
    };
  }

  const bridge =
    ctx.subagent?.runTurn ?? ctx.subagent?.runSubagentTurn ?? ctx.runSubagentTurn;
  if (typeof bridge !== "function") {
    return {
      title: "task",
      output:
        "ERROR task: subagent bridge not available (ctx.subagent is not wired on this runtime). " +
        "Until the subagent bridge lands, use the compiled makeTaskTool registry path.",
      isError: true,
    };
  }

  const bridgePermission =
    ctx.bridgePermission ??
    (async (toolName: string, toolArgs: unknown, _callId: string) =>
      ctx.askPermission(toolName, toolArgs));

  const parentToolCallId = ctx.callId;
  const isResume = typeof args.task_id === "string" && Boolean(args.task_id.trim());

  let result: { title: string; output: string; metadata?: Record<string, unknown>; isError?: boolean };
  try {
    result = await bridge({
      agentKey: agentName,
      description,
      prompt,
      taskId: typeof args.task_id === "string" ? args.task_id : undefined,
      parent: ctx,
      parentSessionId: ctx.sessionId,
      workspaceRoot: ctx.workspaceRoot,
      dataDir: ctx.dataDir,
      abortSignal: ctx.abortSignal,
      bridgePermission,
      onToolCall: ctx.bridgeToolCall
        ? (e: { toolCallId: string; toolName: string; args: unknown }) =>
            ctx.bridgeToolCall({ ...e, parentToolCallId })
        : undefined,
      onToolResult: ctx.bridgeToolResult
        ? (e: { toolCallId: string; toolName: string; args: unknown; output: unknown; isError?: boolean }) =>
            ctx.bridgeToolResult({ ...e, parentToolCallId })
        : undefined,
      onToolUpdate: ctx.bridgeToolUpdate
        ? (e: { toolCallId: string; status: string }) =>
            ctx.bridgeToolUpdate({ ...e, parentToolCallId })
        : undefined,
    });
  } catch (err: unknown) {
    return {
      title: "task",
      output: `ERROR task: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }

  return {
    title: result?.title ?? "task",
    output: result?.output ?? "",
    metadata: result?.metadata ?? { task_id: args.task_id, resume: isResume },
    isError: result?.isError === true,
  };
}
