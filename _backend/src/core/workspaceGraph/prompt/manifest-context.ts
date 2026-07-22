import type { WorkspaceManifestSettings } from "../../../../../_shared/types/config";
import type { WorkspaceGraphService } from "../api/types";

export interface ManifestPromptInput {
  config: WorkspaceManifestSettings;
  graph: WorkspaceGraphService;
  agentId?: string;
}

export async function buildWorkspaceManifestContext(
  input: ManifestPromptInput
): Promise<string | null> {
  const { config, graph, agentId } = input;

  if (!config.enabled) return null;

  if (agentId && config.agents && config.agents.length > 0) {
    if (!config.agents.includes(agentId)) return null;
  }

  const manifest = await graph.manifest.workspaceManifest({
    maxDepth: config.maxDepth ?? 3,
    excludeDirs: config.excludeDirs,
    excludeExtensions: config.excludeExtensions,
  });

  if (!manifest || !manifest.trim()) return null;

  return manifest;
}

export async function buildSystemPromptWithManifest(
  baseSystemPrompt: string,
  input: ManifestPromptInput
): Promise<string> {
  const manifestContext = await buildWorkspaceManifestContext(input);
  if (!manifestContext) return baseSystemPrompt;

  return `${baseSystemPrompt}\n\n## Workspace Manifest\n\n${manifestContext}`;
}