import type { ToolExecutionMode } from "../../../../../_shared/types";

/** Header label for a step tool batch, driven by the configured execution mode. */
export function toolBatchLabel(mode: ToolExecutionMode | undefined): string {
  return `Tool Call Batch: ${mode === "concurrent" ? "Parallel" : "Sequential"}`;
}
