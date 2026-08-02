import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { graphSearchTool } from "../builtins/graph_search";
import { graphFilesTool } from "../builtins/graph_files";
import { graphInfoTool } from "../builtins/graph_info";
import { graphImportsTool } from "../builtins/graph_imports";
import { graphExportsTool } from "../builtins/graph_exports";
import { graphManifestTool } from "../builtins/graph_manifest";
import { graphStatusTool } from "../builtins/graph_status";

/**
 * Consolidated `graph` tool.
 *
 * Replaces the 7 individual graph_* tools with a single tool that dispatches
 * on a required `action` enum. Every original tool name maps to a sub-command
 * with identical behavior — the execute handler forwards to the original
 * tool implementation, so no logic, error handling, or side effects change.
 *
 * Sub-commands:
 *   - search   -> graph_search
 *   - files    -> graph_files
 *   - info     -> graph_info
 *   - imports  -> graph_imports
 *   - exports  -> graph_exports
 *   - manifest -> graph_manifest
 *   - status   -> graph_status
 *
 * Schema is a flat merged object: `action` is the only required field; all
 * params across the 7 original tools are merged as optional (first-wins on
 * collisions widened to unions where the types differ) to minimize JSON
 * schema overhead.
 */
const GRAPH_ACTIONS = [
  "search",
  "files",
  "info",
  "imports",
  "exports",
  "manifest",
  "status",
] as const;

export type GraphAction = (typeof GRAPH_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<GraphAction, ToolDef> = {
  search: graphSearchTool,
  files: graphFilesTool,
  info: graphInfoTool,
  imports: graphImportsTool,
  exports: graphExportsTool,
  manifest: graphManifestTool,
  status: graphStatusTool,
};

/** Combine a set of zod types into one permissive type (union if multiple distinct). */
function combineTypes(types: z.ZodTypeAny[]): z.ZodTypeAny {
  const unique = Array.from(new Set(types));
  if (unique.length === 1) return unique[0];
  return z.union(unique as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

/** Build a flat merged schema: every field from every original tool, all optional. */
function buildMergedSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny[]> = {};
  for (const tool of Object.values(ORIGINAL_TOOLS)) {
    const obj = tool.inputSchema as z.ZodObject<any>;
    const objShape = obj.shape ?? {};
    for (const [key, field] of Object.entries(objShape)) {
      (shape[key] ??= []).push(field as z.ZodTypeAny);
    }
  }
  const merged: Record<string, z.ZodTypeAny> = {};
  for (const [key, typeDefs] of Object.entries(shape)) {
    merged[key] = combineTypes(typeDefs).optional();
  }
  return z.object({
    action: z.enum(GRAPH_ACTIONS),
    ...merged,
  });
}

const graphSchema = buildMergedSchema();

export const graphTool: ToolDef = {
  name: "graph",
  description:
    "Consolidated workspace-graph tool. Search symbols, list files, inspect a file's imports/exports/symbols, and get workspace status or manifest. " +
    "Set the required 'action' to select the operation:\n" +
    "  search   - Search workspace symbols (functions, classes, interfaces, enums, variables) by name (graph_search)\n" +
    "  files    - List all indexed source files, optionally filtered by subdirectory (graph_files)\n" +
    "  info     - Get detailed info for a file: imports, exports, and symbols (graph_info)\n" +
    "  imports  - List all import statements for a file (graph_imports)\n" +
    "  exports  - List all export statements for a file (graph_exports)\n" +
    "  manifest - Get the workspace tree as structured text (graph_manifest)\n" +
    "  status   - Check the workspace graph status (graph_status)",
  permissionDefault: "allow",
  inputSchema: graphSchema,
  execute: async (args, ctx) => {
    const action = args.action as GraphAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown graph action: "${String(args.action)}".`,
        metadata: { found: false },
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const graphActions = GRAPH_ACTIONS;
