import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createDefaultRegistry } from "../features/tools/index";
import { extractToolFields } from "../features/tools/schema";
import { listToolFolders, type ToolFolder } from "../features/tools/folder-store";
import { ToolConfigSchema } from "../config/tool-config";
import type { ToolConfig } from "../../../_shared/types";


export function registerToolsRoutes(app: FastifyInstance, dataDir: string) {
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

    return { tools: builtin };
  });

  // ── per-tool config / entry / skill editing ─────────────────────────
  // GET  /api/tools/:name/config → the tool's <name>.json (ToolConfig)
  // PUT  /api/tools/:name/config → validate + write <name>.json
  // GET  /api/tools/:name/entry  → the entry file text (index.ts/index.js)
  // PUT  /api/tools/:name/entry  → write the entry file text
  // GET  /api/tools/:name/skill  → skill.md text ("" when missing)
  // PUT  /api/tools/:name/skill  → write skill.md text

  app.get("/api/tools/:name/config", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });
    return { ok: true, kind: folder.kind, config: folder.config, dir: folder.dir };
  });

  app.put("/api/tools/:name/config", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });

    const parsed = ToolConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: `invalid tool config: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      });
    }
    const config: ToolConfig = { ...parsed.data, name };
    await writeFile(join(folder.dir, `${name}.json`), JSON.stringify(config, null, 2) + "\n", "utf-8");
    return { ok: true, config };
  });

  app.get("/api/tools/:name/entry", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });
    const code = await readIfExists(folder.entryPath);
    return { ok: true, name, entry: folder.config.entry, code };
  });

  app.put("/api/tools/:name/entry", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });
    const code = (request.body as { code?: unknown })?.code;
    if (typeof code !== "string") {
      return reply.code(400).send({ error: "body.code (string) is required" });
    }
    await mkdir(folder.dir, { recursive: true });
    await writeFile(folder.entryPath, code, "utf-8");
    return { ok: true, name, entry: folder.config.entry, code };
  });

  app.get("/api/tools/:name/skill", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });
    return { ok: true, name, skill: await readIfExists(join(folder.dir, "skill.md")) };
  });

  app.put("/api/tools/:name/skill", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!SAFE_TOOL_NAME.test(name)) {
      return reply.code(400).send({ error: "invalid tool name" });
    }
    const folder = await findToolFolder(dataDir, name);
    if (!folder) return reply.code(404).send({ error: `tool "${name}" not found` });
    const skill = (request.body as { skill?: unknown })?.skill;
    if (typeof skill !== "string") {
      return reply.code(400).send({ error: "body.skill (string) is required" });
    }
    await mkdir(folder.dir, { recursive: true });
    await writeFile(join(folder.dir, "skill.md"), skill, "utf-8");
    return { ok: true, name, skill };
  });
}

/** Tool names become folder names under data/tools/{builtin,custom}/<name>/. */
const SAFE_TOOL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

async function findToolFolder(dataDir: string, name: string): Promise<ToolFolder | null> {
  const folders = await listToolFolders(dataDir);
  return folders.find((f) => f.name === name) ?? null;
}

async function readIfExists(fp: string): Promise<string> {
  if (!existsSync(fp)) return "";
  return readFile(fp, "utf-8");
}
