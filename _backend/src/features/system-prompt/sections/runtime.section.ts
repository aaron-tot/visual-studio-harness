import type { SectionContext } from "./types";
import { formatRuntimeInfo } from "../../mds";

/**
 * Canonical runtime section — the SAME full block (workspace/mode/data_dir/os/
 * datetime/elapsed) wherever it is rendered (base system prompt or the trailing
 * additional_system_info block). Datetime granularity is driven by the caller's
 * `now` (day-granular by default so system and tail match for emit-on-change).
 */
export async function buildSection(ctx: SectionContext): Promise<string | null> {
  return formatRuntimeInfo({
    dataDir: ctx.dataDir,
    workspaceRoot: ctx.workspaceRoot,
    mode: ctx.mode,
    now: ctx.now,
    turnStart: ctx.turnStart,
  });
}
