import type { SectionContext } from "./types";
import { formatRuntimeStatic, formatRuntimeDynamic } from "../../mds";

/**
 * Renders the runtime section. Which parts are included is driven by
 * `ctx.runtimeInclude`:
 * - `static` (default true when unset) → os/workspace/session facts (base system prompt)
 * - `dynamic` (default true when unset) → datetime + turn_elapsed (volatile tail)
 */
export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const inc = ctx.runtimeInclude ?? { static: true, dynamic: true };
  const lines: string[] = [];
  if (inc.static !== false) lines.push(...formatRuntimeStatic(ctx));
  if (inc.dynamic !== false) lines.push(...formatRuntimeDynamic(ctx));
  if (lines.length === 0) return null;
  return ["## Runtime", ...lines].join("\n");
}
