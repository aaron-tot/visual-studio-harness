import type { FastifyInstance } from "fastify";
import {
  listCustomTools,
  readCustomTool,
  writeCustomTool,
  deleteCustomTool,
  ensureCustomToolsDir,
} from "../features/custom-tools/store";
import type { CustomTool } from "../../../_shared/types/custom-tools";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function registerCustomToolsRoutes(app: FastifyInstance, dataDir: string) {
  // List all custom tools
  app.get("/api/custom-tools", async () => {
    await ensureCustomToolsDir(dataDir);
    return { tools: await listCustomTools(dataDir) };
  });

  // Create a new custom tool
  app.post("/api/custom-tools", async (request, reply) => {
    const body = request.body as Partial<CustomTool>;
    const name = body.name?.trim();
    if (!name || !SAFE_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid name (alphanumeric, hyphens, underscores; 1-64 chars)" });
    }
    if (!body.code?.trim()) {
      return reply.code(400).send({ error: "code is required" });
    }
    const existing = await readCustomTool(dataDir, name);
    if (existing) {
      return reply.code(409).send({ error: `tool "${name}" already exists` });
    }
    const tool: CustomTool = {
      name,
      description: body.description?.trim() ?? "",
      inputSchema: (body.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      code: body.code.trim(),
      enabled: body.enabled !== false,
      permissionDefault: body.permissionDefault ?? "ask",
      skillGuide: body.skillGuide?.trim() ?? undefined,
      skillPushMode: body.skillPushMode ?? undefined,
      skillId: body.skillId?.trim() ?? undefined,
      skillCustomPushText: body.skillCustomPushText?.trim() ?? undefined,
    };
    await writeCustomTool(dataDir, tool);
    return { ok: true, tool };
  });

  // Update an existing custom tool
  app.put("/api/custom-tools/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const existing = await readCustomTool(dataDir, name);
    if (!existing) return reply.code(404).send({ error: "tool not found" });

    const body = request.body as Partial<CustomTool>;
    const updated: CustomTool = {
      ...existing,
      description: body.description?.trim() ?? existing.description,
      inputSchema: body.inputSchema ?? existing.inputSchema,
      code: body.code?.trim() ?? existing.code,
      enabled: body.enabled ?? existing.enabled,
      permissionDefault: body.permissionDefault ?? existing.permissionDefault,
      skillGuide: body.skillGuide !== undefined ? (body.skillGuide?.trim() ?? undefined) : existing.skillGuide,
      skillPushMode: body.skillPushMode ?? existing.skillPushMode,
      skillId: body.skillId !== undefined ? (body.skillId?.trim() ?? undefined) : existing.skillId,
      skillCustomPushText: body.skillCustomPushText !== undefined ? (body.skillCustomPushText?.trim() ?? undefined) : existing.skillCustomPushText,
    };
    await writeCustomTool(dataDir, updated);
    return { ok: true, tool: updated };
  });

  // Delete a custom tool
  app.delete("/api/custom-tools/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const existing = await readCustomTool(dataDir, name);
    if (!existing) return reply.code(404).send({ error: "tool not found" });
    await deleteCustomTool(dataDir, name);
    return { ok: true };
  });

  // Toggle enabled/disabled
  app.post("/api/custom-tools/:name/toggle", async (request, reply) => {
    const { name } = request.params as { name: string };
    const existing = await readCustomTool(dataDir, name);
    if (!existing) return reply.code(404).send({ error: "tool not found" });
    existing.enabled = !existing.enabled;
    await writeCustomTool(dataDir, existing);
    return { ok: true, enabled: existing.enabled };
  });
}
