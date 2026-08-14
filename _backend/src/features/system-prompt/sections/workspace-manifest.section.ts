import type { SectionContext } from "./types";
import { buildWorkspaceManifestContext } from "../../../core/workspaceGraph/prompt/manifest-context";

export async function buildSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.graphService) return null;

  const result = await buildWorkspaceManifestContext({
    config: ctx.workspaceManifest ?? {},
    graph: ctx.graphService,
  });

  return result;
}
