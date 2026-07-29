import type { SectionContext } from "./types";
import { readAgentsFromRoot } from "../../agents/md-utils";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const text = await readAgentsFromRoot(ctx.workspaceRoot);
  return text || null;
}
