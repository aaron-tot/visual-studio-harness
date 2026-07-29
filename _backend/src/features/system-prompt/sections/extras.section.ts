import type { SectionContext } from "./types";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.extras || ctx.extras.length === 0) return null;
  const nonEmpty = ctx.extras.map(e => e.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return null;
  return nonEmpty.join("\n\n");
}
