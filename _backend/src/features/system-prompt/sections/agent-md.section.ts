import type { SectionContext } from "./types";
import { resolveAgentMd } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.agentSettings) return null;
  return resolveAgentMd(ctx.agentSettings.agentMd, {
    dataDir: ctx.dataDir,
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
  });
}
