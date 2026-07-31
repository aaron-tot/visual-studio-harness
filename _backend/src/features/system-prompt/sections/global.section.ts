import type { SectionContext } from "./types";
import { globalAgentsPath, readAgentsFile } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const globalFile = globalAgentsPath(ctx.dataDir);
  return readAgentsFile(globalFile);
}
