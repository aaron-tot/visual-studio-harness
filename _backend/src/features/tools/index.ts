import { createRegistry, type ToolRegistry } from "./registry";
import { readTool } from "./builtins/read";
import { writeTool } from "./builtins/write";
import { editTool } from "./builtins/edit";
import { applyPatchTool } from "./builtins/apply_patch";
import { grepTool } from "./builtins/grep";
import { globTool } from "./builtins/glob";
import { bashTool } from "./builtins/bash";
import { todoWriteTool, todoReadTool } from "./builtins/todo";
import { skillTool } from "./builtins/skill";
import { findSymbolTool } from "./builtins/find_symbol";
import { readSymbolTool } from "./builtins/read_symbol";
import { makeTaskTool, taskTool } from "./builtins/task";
import { webfetchTool } from "./builtins/webfetch";
import { websearchTool } from "./builtins/websearch";
import { agentChangeTool } from "./builtins/agent_change";
import { designCreateTool } from "./builtins/design_create";
import { designReadTool } from "./builtins/design_read";
import { designEditTool } from "./builtins/design_edit";
import { designAbandonTool } from "./builtins/design_abandon";
import { designsListTool } from "./builtins/designs_list";
import { setDefaultTools } from "./perms/defaults";
import type { ToolDef } from "./types";
import type { AgentSettings } from "../../../../_shared/types";

const ALL_TOOLS: ToolDef[] = [
  readTool,
  writeTool,
  editTool,
  applyPatchTool,
  grepTool,
  globTool,
  bashTool,
  todoWriteTool,
  todoReadTool,
  skillTool,
  findSymbolTool,
  readSymbolTool,
  taskTool,
  webfetchTool,
  websearchTool,
  agentChangeTool,
  designCreateTool,
  designReadTool,
  designEditTool,
  designsListTool,
  designAbandonTool,
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

export { createRegistry } from "./registry";
export type { ToolRegistry } from "./registry";
export type { ToolDef, BaseToolContext, ExtendedToolContext, ToolResult } from "./types";
export { isStopTurnResult } from "./types";
export { getWorkspaceRoot, resolveWorkspacePath, classifyPath } from "./sandbox";
export { resolveAccessiblePath, EXTERNAL_DIRECTORY_PREFIX } from "./path-access";
export { toolsEnabled, toolsTrusted } from "./permissions";
export {
  resolveToolPermission,
  resolveToolPermissionDetailed,
  resolveAllKnownTools,
} from "./perms/resolve";
export { setTodoDataDir } from "./builtins/todo";
export { setSkillRoots } from "./builtins/skill";
