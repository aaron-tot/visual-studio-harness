import { insertStepPart, updateStepPartData } from "./db-trace";

/**
 * Step-scoped stream writer for the trace schema.
 * Coalesces consecutive text/reasoning deltas into one row.
 * Streaming content writes are debounced (50ms) to batch per-token SQLite writes.
 * Final-state writes (close, tool complete, rebind) flush immediately.
 * seq is turn-global for WS upToSeq compatibility.
 */
let createdStepIdCounter = 0;
const FLUSH_DEBOUNCE_MS = 50;

export function createStepStreamWriter(sessionId: string, turnId: number, stepId: number, dataDir?: string) {
  let currentStepId = stepId;
  let hasBoundStep = stepId > 0;
  let open: { type: "text" | "reasoning"; partId: number; content: string; seq: number } | null = null;
  const toolPartIds = new Map<string, { partId: number; args: unknown; seq: number; toolName: string }>();
  const writerId = ++createdStepIdCounter;

  // ── Debounce state ──────────────────────────────────────────────────
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const doFlushOpen = () => {
    flushTimer = null;
    if (!open) return;
    updateStepPartData(open.partId, { content: open.content }, { seq: open.seq, status: "streaming" }, dataDir);
  };

  const scheduleFlush = () => {
    if (flushTimer) return; // timer already active
    flushTimer = setTimeout(doFlushOpen, FLUSH_DEBOUNCE_MS);
  };

  const flushImmediate = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    doFlushOpen();
  };

  // ── Public API ──────────────────────────────────────────────────────

  const writeDelta = (type: "text" | "reasoning", delta: string, seq: number) => {
    if (!hasBoundStep) return; // no-op until a real step binds
    if (open && open.type === type) {
      open.content += delta;
      open.seq = seq;
      scheduleFlush();           // debounced — batches per-token writes
      return;
    }
    flushImmediate();            // flush prior open before switching type
    const partId = insertStepPart(sessionId, turnId, currentStepId, type, { content: delta }, seq, "streaming", undefined, dataDir);
    open = { type, partId, content: delta, seq };
    scheduleFlush();             // also debounce the new part's first write
  };

  const setToolPart = (
    toolCallId: string,
    toolName: string,
    args: unknown,
    seq: number,
    stepIndex?: number,
    parentToolCallId?: string,
  ) => {
    if (!hasBoundStep) return; // no-op until a real step binds
    flushImmediate();             // flush streaming open before creating tool row
    const partId = insertStepPart(
      sessionId, turnId, currentStepId, "tool",
      { toolCallId, toolName, args, stepIndex },
      seq, "running",
      { toolCallId, toolName, parentToolCallId },
      dataDir,
    );
    toolPartIds.set(toolCallId, { partId, args, seq, toolName, stepIndex });
  };

  const updateToolResult = (toolCallId: string, result: unknown, isError?: boolean) => {
    const entry = toolPartIds.get(toolCallId);
    if (!entry) return;
    flushImmediate();             // ensure any pending open text is written first
    // Keep toolName on the data blob — projections and UI headers read it from data
    const data = { toolCallId, toolName: entry.toolName, args: entry.args, result, isError, stepIndex: entry.stepIndex };
    updateStepPartData(entry.partId, data, { status: isError ? "error" : "completed" }, dataDir);
    toolPartIds.delete(toolCallId);
  };

  const closeOpen = () => {
    if (!open) return;
    flushImmediate();             // final state — write the complete content with "completed"
    updateStepPartData(open.partId, { content: open.content }, { status: "completed" }, dataDir);
    open = null;
  };

  const rebindStep = (newStepId: number) => {
    closeOpen();
    currentStepId = newStepId;
    hasBoundStep = true;
    toolPartIds.clear();
  };

  return { writeDelta, closeOpen, toolPartIds, setToolPart, updateToolResult, rebindStep, getOpen: () => open };
}
