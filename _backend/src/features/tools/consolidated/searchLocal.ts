import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { grepTool } from "../builtins/grep";
import { globTool } from "../builtins/glob";

/**
 * Consolidated `searchLocal` tool.
 *
 * Replaces grep (regex content search) and glob (filename/glob search) with a
 * single registered tool that dispatches on a required `action` enum.
 *
 * Sub-commands (via `action`):
 *   grep - Regex search file contents via ripgrep (respects .gitignore)
 *   glob - Find files by name/glob pattern
 */
const SEARCH_LOCAL_ACTIONS = ["grep", "glob"] as const;
export type SearchLocalAction = (typeof SEARCH_LOCAL_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<SearchLocalAction, ToolDef> = {
  grep: grepTool,
  glob: globTool,
};

const searchLocalSchema = z.object({
  action: z.enum(SEARCH_LOCAL_ACTIONS).describe("Operation: grep (content) or glob (filename)"),
  pattern: z.string().optional().describe("Regex (grep) or glob pattern (glob)"),
  path: z.string().optional().describe("File/dir under workspace"),
  glob: z.string().optional().describe('File filter e.g. "*.ts" (grep)'),
  case_insensitive: z.boolean().optional().describe("Case-insensitive (grep)"),
  head_limit: z.number().int().min(1).max(1000).optional().describe("Max results"),
});

export const searchLocalTool: ToolDef = {
  name: "searchLocal",
  description:
    "Search local workspace files: regex content search (grep) or filename/glob search (glob). " +
    "Set 'action'. See skill:search-local for usage.",
  permissionDefault: "allow",
  inputSchema: searchLocalSchema,
  execute: async (args, ctx) => {
    const action = args.action as SearchLocalAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown searchLocal action: "${String(args.action)}".`,
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const searchLocalActions = SEARCH_LOCAL_ACTIONS;
