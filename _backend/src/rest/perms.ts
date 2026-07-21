import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import type { PermissionMode } from "../../../_shared/types";
import {
  ensureGlobal,
  readGlobal,
  writeGlobal,
  resetGlobal,
  readWorkspace,
  writeWorkspace,
  readSession,
  writeSession,
} from "../features/tools/perms/store";
import { resolveAllKnownTools } from "../features/tools/perms/resolve";
import { getSessionMetaPublic } from "../storage/session";

function isToolsMap(v: unknown): v is Record<string, PermissionMode> {
  if (!v || typeof v !== "object") return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (val !== "allow" && val !== "ask" && val !== "deny") return false;
  }
  return true;
}

export function registerPermsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/perms/global", async () => {
    const { path, exists, file } = await readGlobal(dataDir);
    return {
      layer: "global" as const,
      path,
      exists,
      tools: file.tools,
      version: file.version,
    };
  });

  app.put("/api/perms/global", async (request, reply) => {
    try {
      const body = (request.body || {}) as { version?: number; tools?: unknown };
      if (!isToolsMap(body.tools)) {
        return reply.code(400).send({ error: "tools map with allow|ask|deny required" });
      }
      await ensureGlobal(dataDir);
      const file = await writeGlobal(dataDir, body.tools, body.version ?? 1);
      return {
        layer: "global" as const,
        path: (await readGlobal(dataDir)).path,
        exists: true,
        tools: file.tools,
        version: file.version,
      };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "unknown error" });
    }
  });

  app.post("/api/perms/global/reset", async () => {
    const file = await resetGlobal(dataDir);
    const { path } = await readGlobal(dataDir);
    return {
      layer: "global" as const,
      path,
      exists: true,
      tools: file.tools,
      version: file.version,
    };
  });

  app.get("/api/perms/workspace", async (request, reply) => {
    const q = request.query as { path?: string };
    const root = (q.path || "").trim();
    if (!root) return reply.code(400).send({ error: "path query required" });
    if (!root.startsWith("/")) {
      return reply.code(400).send({ error: "path must be absolute" });
    }
    const { path, exists, file } = await readWorkspace(resolve(root));
    return {
      layer: "workspace" as const,
      path,
      exists,
      tools: file.tools,
      version: file.version,
      workspaceRoot: resolve(root),
    };
  });

  app.put("/api/perms/workspace", async (request, reply) => {
    const body = (request.body || {}) as { path?: string; tools?: unknown; version?: number };
    const root = (body.path || "").trim();
    if (!root) return reply.code(400).send({ error: "path required" });
    if (!root.startsWith("/")) {
      return reply.code(400).send({ error: "path must be absolute" });
    }
    if (!isToolsMap(body.tools)) {
      return reply.code(400).send({ error: "tools map with allow|ask|deny required" });
    }
    const file = await writeWorkspace(resolve(root), body.tools, body.version ?? 1);
    const { path } = await readWorkspace(resolve(root));
    return {
      layer: "workspace" as const,
      path,
      exists: true,
      tools: file.tools,
      version: file.version,
      workspaceRoot: resolve(root),
    };
  });

  app.get("/api/perms/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id?.trim()) return reply.code(400).send({ error: "session id required" });
    const { path, exists, file } = await readSession(dataDir, id);
    return {
      layer: "session" as const,
      path,
      exists,
      tools: file.tools,
      version: file.version,
      sessionId: id,
    };
  });

  app.put("/api/perms/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { version?: number; tools?: unknown };
    if (!id?.trim()) return reply.code(400).send({ error: "session id required" });
    if (!isToolsMap(body.tools)) {
      return reply.code(400).send({ error: "tools map with allow|ask|deny required" });
    }
    const file = await writeSession(dataDir, id, body.tools, body.version ?? 1);
    const { path } = await readSession(dataDir, id);
    return {
      layer: "session" as const,
      path,
      exists: true,
      tools: file.tools,
      version: file.version,
      sessionId: id,
    };
  });

  app.get("/api/perms/resolved", async (request, reply) => {
    const q = request.query as { sessionId?: string };
    const sessionId = (q.sessionId || "").trim();
    if (!sessionId) return reply.code(400).send({ error: "sessionId query required" });

    const meta = await getSessionMetaPublic(dataDir, sessionId);
    if (!meta) return reply.code(404).send({ error: "session not found" });

    const resolved = await resolveAllKnownTools({
      dataDir,
      sessionId,
      workspaceRoot: meta.workspaceRoot,
    });

    const tools: Record<string, { mode: string; source: string }> = {};
    for (const [name, r] of Object.entries(resolved)) {
      tools[name] = { mode: r.mode, source: r.source };
    }

    return {
      sessionId,
      workspaceRoot: meta.workspaceRoot ?? null,
      tools,
    };
  });
}
