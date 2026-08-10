import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRegistry, type ToolRegistry } from "./registry";
import { listToolFolders, loadToolsFromFolders } from "./folder-store";
import { readTool } from "./builtins/read";
import { writeTool } from "./builtins/write";
import { editTool } from "./builtins/edit";
import { applyPatchTool } from "./builtins/apply_patch";
import { bashTool } from "./builtins/bash";
import { skillTool } from "./builtins/skill";
import { makeTaskTool, taskTool } from "./builtins/task";
import { agentChangeTool } from "./builtins/agent_change";
import { customToolTool } from "./builtins/custom_tool";
import { designTool } from "./consolidated/design";
import { listTool } from "./builtins/list";
import { notesTool } from "./consolidated/notes";
import { auditTool } from "./consolidated/audit";
import { graphTool } from "./consolidated/graph";
import { knowledgeTool } from "./consolidated/knowledge";
import { todoTool } from "./consolidated/todo";
import { searchLocalTool } from "./consolidated/searchLocal";
import { searchOnlineTool } from "./consolidated/searchOnline";
import { setDefaultTools } from "./perms/defaults";
import type { ToolDef } from "./types";
import type { AgentSettings } from "../../../../_shared/types";

const ALL_TOOLS: ToolDef[] = [
  readTool,
  writeTool,
  editTool,
  applyPatchTool,
  bashTool,
  skillTool,
  makeTaskTool,
  taskTool,
  agentChangeTool,
  customToolTool,
  designTool,
  listTool,
  notesTool,
  auditTool,
  graphTool,
  knowledgeTool,
  todoTool,
  searchLocalTool,
  searchOnlineTool,
];

/**
 * Authoritative list of builtin tool names (folder-per-tool seed targets).
 * Derived from ALL_TOOLS, filtering out non-ToolDef entries (the `makeTaskTool`
 * factory is a function, not a tool) and deduping (task appears once).
 *
 * webfetch/websearch intentionally have NO compiled ToolDef and are NOT seeded
 * or registered: the consolidated `searchOnline` ToolDef is the single callable
 * online tool. Their `seeds/{mode}/builtin-tools/` folders remain in the repo
 * as content-only reference for that logic.
 */
export const BUILTIN_TOOL_NAMES: readonly string[] = [
  ...new Set(
    ALL_TOOLS.filter((t): t is ToolDef => typeof t === "object" && t !== null).map(
      (t) => t.name
    )
  ),
];

export interface CreateRegistryOptions {
  /** Tool names to omit (e.g. ["task"] for subagent sessions). */
  exclude?: string[];
  /** Extra tools to register (e.g. from MCP servers). */
  extraTools?: ToolDef[];
}

/** Full V1 native tool set (optional exclusions + dynamic agents for task tool). */
export function createDefaultRegistry(
  opts?: CreateRegistryOptions,
  agents?: Record<string, AgentSettings>
): ToolRegistry {
  setDefaultTools(ALL_TOOLS);
  const registry = createRegistry();
  const exclude = new Set(opts?.exclude ?? []);
  for (const t of ALL_TOOLS) {
    if (!exclude.has(t.name)) {
      if (t.name === "task") {
        registry.register(makeTaskTool(agents));
      } else {
        registry.register(t);
      }
    }
  }
  if (opts?.extraTools) {
    for (const t of opts.extraTools) {
      if (!exclude.has(t.name)) {
        registry.register(t);
      }
    }
  }
  return registry;
}

/**
 * Build a registry from the data folders (`data/tools/{builtin,custom}/<name>/`).
 * Additive during migration: `createDefaultRegistry` (compiled builtins) is unchanged;
 * the run-turn call site switches to this once builtins are re-authored + cloned.
 */
export async function createFolderRegistry(
  dataDir: string,
  opts?: CreateRegistryOptions,
  agents?: Record<string, AgentSettings>
): Promise<ToolRegistry> {
  const folders = await listToolFolders(dataDir);
  const folderTools = await loadToolsFromFolders(dataDir);

  // Compiled binary / fresh install before the first seed has no builtin tool
  // folders under data. Fall back to the compiled ALL_TOOLS for the builtin
  // set (mirroring loadLiveToolDefs' existsSync guard) while keeping any
  // folder custom tools. This guarantees the packaged binary ships the full
  // native tool set even when folder seeding can't run.
  const tools = folders.some((f) => f.kind === "builtin")
    ? folderTools
    : [...ALL_TOOLS, ...folderTools];

  setDefaultTools(tools);
  const registry = createRegistry();
  const exclude = new Set(opts?.exclude ?? []);
  for (const t of tools) {
    if (exclude.has(t.name)) {
      continue;
    }
    if (t.name === "task") {
      registry.register(makeTaskTool(agents));
    } else {
      registry.register(t);
    }
  }
  if (opts?.extraTools) {
    for (const t of opts.extraTools) {
      if (!exclude.has(t.name)) {
        registry.register(t);
      }
    }
  }
  return registry;
}

/**
 * Resolve the "live" builtin tool set for perms defaulting and the perms UI
 * listing. When `data/tools/builtin/` exists (the unified folder shape) the
 * folder tools are used; otherwise it falls back to the compiled ToolDefs
 * (e.g. fresh installs before the first seed, or a compiled binary with no
 * bundled seeds). This keeps startup perms defaulting working in both shapes.
 */
export async function loadLiveToolDefs(dataDir: string): Promise<ToolDef[]> {
  const builtinRoot = join(dataDir, "tools", "builtin");
  if (existsSync(builtinRoot)) {
    const folderTools = await loadToolsFromFolders(dataDir);
    if (folderTools.length > 0) return folderTools;
  }
  return ALL_TOOLS;
}

export { createRegistry } from "./registry";
export type { ToolRegistry } from "./registry";
export type { ToolDef, BaseToolContext, ExtendedToolContext, ToolResult } from "./types";
export { isStopTurnResult } from "./types";
export {
  listToolFolders,
  loadToolEntry,
  loadToolsFromFolders,
  resolveToolCtx,
  folderToToolDef,
  normalizeToolResult,
  type ToolFolder,
  type ToolCtx,
} from "./folder-store";
export { getWorkspaceRoot, resolveWorkspacePath, classifyPath } from "./sandbox";
export { resolveAccessiblePath, EXTERNAL_DIRECTORY_PREFIX } from "./path-access";
export { toolsEnabled, toolsTrusted } from "./permissions";
export {
  resolveToolPermission,
  resolveToolPermissionDetailed,
  resolveAllKnownTools,
} from "./perms/resolve";
export { setSkillRoots, setCustomToolsSkillDir } from "./builtins/skill";
