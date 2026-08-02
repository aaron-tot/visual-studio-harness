import type {
  StepToolCall,
  StepToolBatchResult,
  StepToolBatchBeforePayload,
  StepToolBatchAfterPayload,
} from "../../../../_shared/types/step-batch";

export interface StepToolBatchFns {
  onBefore?: (p: StepToolBatchBeforePayload) => void | Promise<void>;
  onAfter?: (p: StepToolBatchAfterPayload) => void | Promise<void>;
}

export class StepToolBatch {
  private entries: StepToolBatchResult[] = [];
  private stepIndex = 0;
  private beforeFired = false;
  private afterFired = false;
  private readonly fns: StepToolBatchFns;

  constructor(fns: StepToolBatchFns = {}) {
    this.fns = fns;
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Call on SDK start-step: begin a fresh batch for this step. */
  start(stepIndex: number): void {
    this.entries = [];
    this.stepIndex = stepIndex;
    this.beforeFired = false;
    this.afterFired = false;
  }

  /** Call on SDK tool-call event. Order of calls is preserved. */
  addCall(call: StepToolCall): void {
    this.entries.push({ ...call });
  }

  /** Call on SDK tool-result / tool-error with an id to match. */
  addResult(toolCallId: string, result: unknown, isError = false): void {
    const e = this.entries.find((x) => x.toolCallId === toolCallId);
    if (e) {
      e.result = result;
      e.isError = isError;
    }
  }

  /** Emit before exactly once (no-op if empty or already fired). */
  async fireBefore(): Promise<void> {
    if (this.beforeFired || this.entries.length === 0) return;
    this.beforeFired = true;
    await this.fns.onBefore?.({
      stepIndex: this.stepIndex,
      toolCalls: this.entries.map(({ toolCallId, toolName, args }) => ({ toolCallId, toolName, args })),
    });
  }

  /** Emit after exactly once (no-op if empty or already fired). */
  async fireAfter(): Promise<void> {
    if (this.afterFired || this.entries.length === 0) return;
    this.afterFired = true;
    await this.fns.onAfter?.({
      stepIndex: this.stepIndex,
      toolCalls: this.entries.map(({ toolCallId, toolName, args, result, isError }) => ({ toolCallId, toolName, args, result, isError })),
    });
  }
}
