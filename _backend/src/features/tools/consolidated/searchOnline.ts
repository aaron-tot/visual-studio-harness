import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { websearchTool } from "../builtins/websearch";
import { webfetchTool } from "../builtins/webfetch";
import { getSearchProviderRegistry } from "../host/search-provider-registry";

/**
 * Consolidated `searchOnline` tool.
 *
 * Replaces websearch (discover by query) and webfetch (fetch a known URL) with
 * a single registered tool that dispatches on a required `action` enum.
 *
 * Sub-commands (via `action`):
 *   search - Search the web by query (websearch)
 *   fetch  - Fetch a known URL (webfetch)
 */
const SEARCH_ONLINE_ACTIONS = ["search", "fetch"] as const;
export type SearchOnlineAction = (typeof SEARCH_ONLINE_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<SearchOnlineAction, ToolDef> = {
  search: websearchTool,
  fetch: webfetchTool,
};

const searchOnlineSchema = z.object({
  action: z.enum(SEARCH_ONLINE_ACTIONS).describe("Operation: search (query) or fetch (URL)"),
  query: z.string().optional().describe("Search query (search)"),
  numResults: z.number().int().min(1).max(20).optional().describe("Number of results"),
  type: z.enum(["auto", "fast", "deep"]).optional().describe("Search depth"),
  livecrawl: z.enum(["fallback", "preferred"]).optional().describe("Live crawl"),
  contextMaxCharacters: z.number().int().min(500).max(50000).optional().describe("Max context chars"),
  provider: z.string().optional().describe("Force specific provider by id (from registry)"),
  url: z.string().optional().describe("URL to fetch (fetch)"),
  format: z.enum(["markdown", "text", "html"]).optional().describe("Return format (fetch)"),
  timeout: z.number().int().positive().optional().describe("Timeout seconds (fetch)"),
});

export const searchOnlineTool: ToolDef = {
  name: "searchOnline",
  description:
    "Search the web by query or fetch a known URL. Set 'action' to search or fetch. " +
    "For search: provider is a provider id from the search provider registry (not just exa/parallel). " +
    "See skill:search-online for websearch backends.",
  permissionDefault: "allow",
  inputSchema: searchOnlineSchema,
  execute: async (args, ctx) => {
    const action = args.action as SearchOnlineAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown searchOnline action: "${String(args.action)}".`,
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const searchOnlineActions = SEARCH_ONLINE_ACTIONS;

/** Get available provider ids for validation/UI. */
export function getAvailableProviderIds(): string[] {
  const registry = getSearchProviderRegistry();
  return registry.getAll().filter((p) => p.enabled).map((p) => p.id);
}
