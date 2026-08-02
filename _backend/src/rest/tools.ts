import type { FastifyInstance } from "fastify";
import { createDefaultRegistry } from "../features/tools/index";
import { extractToolFields } from "../features/tools/schema";
import { loadCustomToolDefs } from "../features/custom-tools/store";

export function registerToolsRoutes(app: FastifyInstance, dataDir?: string) {
  app.get("/api/tools", async () => {
    const registry = createDefaultRegistry();
    const defs = registry.list();
    const builtin = defs.map((d) => ({
      name: d.name,
      description: d.description,
      permissionDefault: d.permissionDefault,
      inputFields: extractToolFields(d.inputSchema),
      outputFields: d.outputFields || [],
    }));

    // Include custom tools in the tool list
    const custom = dataDir ? (await loadCustomToolDefs(dataDir)).map((d) => ({
      name: d.name,
      description: d.description,
      permissionDefault: d.permissionDefault,
      inputFields: extractToolFields(d.inputSchema),
      outputFields: d.outputFields || [],
    })) : [];

    return { tools: [...builtin, ...custom] };
  });
}
