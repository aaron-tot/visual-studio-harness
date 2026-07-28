import type { SectionContext } from "./types";
import { resolveAgentMd } from "../../agents/md-utils";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.agentSettings) return null;
  return resolveAgentMd(ctx.agentSettings.agentMd);
}