import { insertStepPart, updateStepPartData } from "./db-trace";

/**
 * Step-scoped stream writer for the trace schema.
 * Coalesces consecutive text/reasoning deltas into one row (same pattern as today).
 * seq is turn-global for WS upToSeq compatibility.
 */
let createdStepIdCounter = 0;

export function createStepStreamWriter(sessionId: string, turnId: number, stepId: number, dataDir?: string) {
  let currentStepId = stepId;
  let hasBoundStep = stepId > 0;
  let open: { type: "text" | "reasoning"; partId: number; content: string; seq: number } | null = null;
  const toolPartIds = new Map<string, { partId: number; args: unknown; seq: number }>();
  const writerId = ++createdStepIdCounter;

  const writeDelta = (type: "text" | "reasoning", delta: string, seq: number) => {
    if (!hasBoundStep) return; // no-op until a real step binds
    if (open && open.type === type) {
      open.content += delta;
      open.seq = seq;
      updateStepPartData(open.partId, { content: open.content }, { seq, status: "streaming" }, dataDir);
      return;
    }
    closeOpen();
    const partId = insertStepPart(sessionId, turnId, currentStepId, type, { content: delta }, seq, "streaming", undefined, dataDir);
    open = { type, partId, content: delta, seq };
  };

  const setToolPart = (
    toolCallId: string,
    toolName: string,
    args: unknown,
    seq: number,
    parentToolCallId?: string,
  ) => {
    if (!hasBoundStep) return; // no-op until a real step binds
    closeOpen();
    const partId = insertStepPart(
      sessionId, turnId, currentStepId, "tool",
      { toolCallId, toolName, args },
      seq, "running",
      { toolCallId, toolName, parentToolCallId },
      dataDir,
    );
    toolPartIds.set(toolCallId, { partId, args, seq });
  };

  const updateToolResult = (toolCallId: string, result: unknown, isError?: boolean) => {
    const entry = toolPartIds.get(toolCallId);
    if (!entry) return;
    const data = { toolCallId, args: entry.args, result, isError };
    updateStepPartData(entry.partId, data, { status: isError ? "error" : "completed" }, dataDir);
    toolPartIds.delete(toolCallId);
  };

  const closeOpen = () => {
    if (open) {
      updateStepPartData(open.partId, { content: open.content }, { status: "completed" }, dataDir);
      open = null;
    }
  };

  const rebindStep = (newStepId: number) => {
    closeOpen();
    currentStepId = newStepId;
    hasBoundStep = true;
    toolPartIds.clear();
  };

  return { writeDelta, closeOpen, toolPartIds, setToolPart, updateToolResult, rebindStep, getOpen: () => open };
}
