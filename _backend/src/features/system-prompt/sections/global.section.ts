import type { SectionContext } from "./types";
import { globalAgentsPath } from "../../agents/paths";
import { readAgentsFile } from "../../agents/md-utils";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  const globalFile = globalAgentsPath(ctx.dataDir);
  return readAgentsFile(globalFile);
}