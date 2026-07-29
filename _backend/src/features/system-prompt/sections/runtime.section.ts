import type { SectionContext } from "./types";
import { formatRuntimeInfo } from "../../agents/format";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  return formatRuntimeInfo({
    dataDir: ctx.dataDir,
    workspaceRoot: ctx.workspaceRoot,
    mode: ctx.mode,
    sessionId: ctx.sessionId,
    now: ctx.now,
  });
}
