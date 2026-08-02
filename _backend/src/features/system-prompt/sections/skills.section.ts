import type { SectionContext } from "./types";
import { resolveSkillMds } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.agentSettings) return null;
  const skillContents = await resolveSkillMds(ctx.agentSettings.skillMds, {
    dataDir: ctx.dataDir,
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
  });
  if (skillContents.length === 0) return null;
  return skillContents.join("\n\n");
}
