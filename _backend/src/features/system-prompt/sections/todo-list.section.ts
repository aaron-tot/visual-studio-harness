import type { SectionContext } from "./types";
import { formatTodoList } from "../../agents/todo-list-format";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  return formatTodoList(ctx.sessionId, ctx.dataDir);
}