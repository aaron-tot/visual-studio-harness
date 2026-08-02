import type { SectionContext } from "./types";
import { globalSystemPromptPath, readAgentsFile, resolveAgentMd } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  // Per-agent override takes priority
  if (ctx.agentSettings?.systemPromptBase) {
    const resolved = await resolveAgentMd(ctx.agentSettings.systemPromptBase, {
      dataDir: ctx.dataDir,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    if (resolved) return resolved;
  }
  // Fallback: V2 default path
  const globalFile = globalSystemPromptPath(ctx.dataDir);
  return readAgentsFile(globalFile);
}
