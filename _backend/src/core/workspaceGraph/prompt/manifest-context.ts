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

  const maxDepth = config.maxDepth ?? 3;
  const includeFiles = config.includeFiles ?? false;

  const manifest = await graph.manifest.workspaceManifest({
    maxDepth,
    includeFiles,
    excludeDirs: config.excludeDirs,
    excludeExtensions: config.excludeExtensions,
  });

  if (!manifest || !manifest.trim()) return null;

  const excludeDirs = config.excludeDirs?.length
    ? config.excludeDirs.join(", ")
    : "node_modules, .git, dist, build, .vsh, coverage, .turbo";
  const excludeExts = config.excludeExtensions?.length
    ? config.excludeExtensions.join(", ")
    : ".png, .jpg, .jpeg, .gif, .svg, .ico, .woff2, .woff, .eot, .ttf";

  const meta = [
    `Max depth: ${maxDepth} levels${!includeFiles ? " (use graph_files to list files in specific directories)" : ""}`,
    includeFiles ? "Includes: files and directories" : "Includes: directories only",
    `Excluded dirs: ${excludeDirs}`,
    `Excluded extensions: ${excludeExts}`,
  ].join("\n");

  return `${meta}\n\n${manifest}\n\nNote: Manifest refreshes each turn. For files, symbols, functions, classes, imports/exports use graph tools.`;
}

export async function buildSystemPromptWithManifest(
  baseSystemPrompt: string,
  input: ManifestPromptInput
): Promise<string> {
  const manifestContext = await buildWorkspaceManifestContext(input);
  if (!manifestContext) return baseSystemPrompt;

  const prefix = input.config.prefix ?? "## Workspace Manifest\n\n";
  const postfix = input.config.postfix ?? "";

  return `${baseSystemPrompt}\n\n${prefix}${manifestContext}${postfix}`;
}