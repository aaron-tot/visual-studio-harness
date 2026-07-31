import type { SectionContext } from "./types";
import { readProjectAgentsMd } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const text = await readProjectAgentsMd(ctx.workspaceRoot);
  return text || null;
}
