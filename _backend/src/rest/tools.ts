import type { FastifyInstance } from "fastify";
import { createDefaultRegistry } from "../features/tools/index";
import { extractToolFields } from "../features/tools/schema";

export function registerToolsRoutes(app: FastifyInstance) {
  app.get("/api/tools", async () => {
    const registry = createDefaultRegistry();
    const defs = registry.list();
    return {
      tools: defs.map((d) => ({
        name: d.name,
        description: d.description,
        permissionDefault: d.permissionDefault,
        inputFields: extractToolFields(d.inputSchema),
        outputFields: d.outputFields || [],
      })),
    };
  });
}
