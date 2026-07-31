import type { SectionContext } from "./types";
import { formatTodoList } from "../../mds";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  return formatTodoList(ctx.sessionId, ctx.dataDir);
}
