import { createRegistry, type ToolRegistry } from "./registry";
import { loadToolsFromFolders } from "./folder-store";
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
 */
export const BUILTIN_TOOL_NAMES: readonly string[] = [
  ...new Set(
    ALL_TOOLS.filter((t): t is ToolDef => typeof t === "object" && t !== null).map((t) => t.name)
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
  const folderTools = await loadToolsFromFolders(dataDir);
  setDefaultTools(folderTools);
  const registry = createRegistry();
  const exclude = new Set(opts?.exclude ?? []);
  for (const t of folderTools) {
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
export { setTodoDataDir } from "./builtins/todo";
export { setSkillRoots, setCustomToolsSkillDir } from "./builtins/skill";
