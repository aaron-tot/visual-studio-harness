import { z } from "zod";
import type { ToolDef } from "../types";
import { getKbService } from "./knowledge_common";

export const knowledgeIngestTool: ToolDef = {
  name: "knowledge_ingest",
  description:
    "Trigger re-ingestion of knowledge sources. Scans the sources directory for new, modified, or deleted files " +
    "and updates the index. Use after manually adding/removing files from the knowledge sources folder.",
  permissionDefault: "allow",
  inputSchema: z.object({
    scope: z.enum(["global", "project", "session"]).default("session").describe("Scope to ingest"),
  }),
  execute: async (args, ctx) => {
    const kb = getKbService();
    const result = await kb.ingest((args.scope as "global" | "project" | "session") || "session");
    return {
      title: "Ingestion triggered",
      output: `Scan complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted${
        result.failed.length > 0 ? `, ${result.failed.length} failed` : ""
      }`,
      metadata: { added: result.added, updated: result.updated, deleted: result.deleted, failed: result.failed.length },
    };
  },
};
