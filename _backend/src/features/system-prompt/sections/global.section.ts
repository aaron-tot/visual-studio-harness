import type { SectionContext } from "./types";
import { globalSystemPromptPath, readAgentsFile } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const globalFile = globalSystemPromptPath(ctx.dataDir);
  return readAgentsFile(globalFile);
}
