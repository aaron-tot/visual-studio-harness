import type { SectionContext } from "./types";
import { readAgentsFromRoot } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const text = await readAgentsFromRoot(ctx.workspaceRoot);
  return text || null;
}
