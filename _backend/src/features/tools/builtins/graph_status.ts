import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";

export const graphStatusTool: ToolDef = {
  name: "graph_status",
  description:
    "Check the workspace graph status: current state (idle/indexing/watching), indexed file count, folder count, symbol count, languages supported, and last index time.",
  permissionDefault: "allow",
  outputFields: [
    { name: "fileCount", type: "integer", description: "Number of indexed files", required: true },
    { name: "folderCount", type: "integer", description: "Number of indexed folders", required: true },
    { name: "symbolCount", type: "integer", description: "Number of indexed symbols", required: true },
    { name: "languages", type: "string[]", description: "Supported languages", required: true },
    { name: "lastIndexedAt", type: "string", description: "ISO timestamp of last indexing", required: false },
    { name: "dbPath", type: "string", description: "Path to graph database", required: true },
  ],
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    if (!ctx.graphService) {
      return { title: "graph_status", output: "Graph service not available (workspace graph may be disabled or still initializing)", isError: true };
    }
    const status = await ctx.graphService.getStatus();
    const lines = [
      `Files: ${status.fileCount}`,
      `Folders: ${status.folderCount}`,
      `Symbols: ${status.symbolCount}`,
      `Languages: ${status.languages.join(", ") || "none"}`,
      `Last indexed: ${status.lastIndexedAt ? new Date(status.lastIndexedAt).toISOString() : "never"}`,
      `DB path: ${status.dbPath}`,
    ];
    return { title: "graph_status", output: lines.join("\n") };
  },
};
