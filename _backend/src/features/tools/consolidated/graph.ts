import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { graphSearchTool } from "../builtins/graph_search";
import { graphFilesTool } from "../builtins/graph_files";
import { graphInfoTool } from "../builtins/graph_info";
import { graphImportsTool } from "../builtins/graph_imports";
import { graphExportsTool } from "../builtins/graph_exports";
import { graphManifestTool } from "../builtins/graph_manifest";
import { graphStatusTool } from "../builtins/graph_status";
import { findSymbolTool } from "../builtins/find_symbol";
import { readSymbolTool } from "../builtins/read_symbol";

/**
 * Consolidated `graph` tool.
 *
 * Replaces the 7 individual graph_* tools PLUS find_symbol/read_symbol with a
 * single registered tool that dispatches on a required `action` enum.
 *
 * Sub-commands (via `action`):
 *   search       - Search workspace symbols by name (graph index)   (graph_search)
 *   files        - List indexed source files, by subdirectory        (graph_files)
 *   info         - Get a file's imports, exports, and symbols        (graph_info)
 *   imports      - List import statements for a file                 (graph_imports)
 *   exports      - List export statements for a file                 (graph_exports)
 *   manifest     - Get the workspace tree as structured text         (graph_manifest)
 *   status       - Check the workspace graph status                  (graph_status)
 *   symbol_find  - Find symbol definitions by name substring (regex) (find_symbol)
 *   symbol_read  - Read the source region for a symbol name          (read_symbol)
 *
 * Note: `search` uses the indexed graph (may be unavailable/initializing);
 * `symbol_find`/`symbol_read` use a regex scanner that always works.
 * Schema is a flat object: `action` is the only required field.
 */
const GRAPH_ACTIONS = [
  "search",
  "files",
  "info",
  "imports",
  "exports",
  "manifest",
  "status",
  "symbol_find",
  "symbol_read",
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
  symbol_find: findSymbolTool,
  symbol_read: readSymbolTool,
};

const graphSchema = z.object({
  action: z.enum(GRAPH_ACTIONS).describe("Operation: search, files, info, imports, exports, manifest, status, symbol_find, symbol_read"),
  name: z.string().optional().describe("Symbol name or substring"),
  kind: z
    .enum(["function", "class", "interface", "enum", "variable", "type"])
    .optional()
    .describe("Symbol kind"),
  folder_path: z.string().optional().describe("Subdirectory"),
  file_path: z.string().optional().describe("File path"),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Max tree depth"),
  include_files: z.boolean().optional().describe("Include files"),
  query: z.string().optional().describe("Symbol name or substring (symbol_find)"),
  path: z.string().optional().describe("Limit to a file/subdirectory (symbol_find/read)"),
  head_limit: z.number().int().min(1).max(100).optional().describe("Max hits"),
  context_lines: z.number().int().min(0).max(50).optional().describe("Context lines (symbol_read)"),
});

export const graphTool: ToolDef = {
  name: "graph",
  description:
    "Query workspace symbols and files: search the graph index, inspect imports/exports, get status/manifest, " +
    "and locate or read symbol source. Set 'action'. See skill:graph.",
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
