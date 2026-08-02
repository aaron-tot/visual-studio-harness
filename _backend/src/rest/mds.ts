import type { FastifyInstance } from "fastify";
import { join, dirname } from "node:path";
import { mkdir, writeFile, stat, rename, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getSession } from "../storage/session";
import { resolveDataDirInfo, getMode } from "../paths";
import { resolveMdsScopeDir, globalSystemPromptPath } from "../features/mds/paths";
import { listAgentsMdAtRoot } from "../features/mds/reader";
import {
  collectScopeTags,
  listScopeItems,
  walkDir,
  bumpPromptJson,
  RESERVED_MDS_DIRS,
  ensureDefaultMdsDirs,
  safeRelPath,
  resolveMdsContext,
} from "../features/mds/scope";

export function registerMdsRoutes(app: FastifyInstance, dataDir: string) {


  app.get("/api/mds/scope-paths", async (request) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const { dataDir: resolvedDataDir, source } = resolveDataDirInfo();
    const mode = getMode();

    let wsRoot = (q.workspaceRoot || "").trim();
    if (q.sessionId) {
      const session = await getSession(resolvedDataDir, q.sessionId);
      if (session?.meta?.workspaceRoot) wsRoot = session.meta.workspaceRoot;
    }

    const globalPath = resolveMdsScopeDir("global", resolvedDataDir);
    const projectPath = resolveMdsScopeDir("project", resolvedDataDir, wsRoot || undefined);
    const sessionPath = resolveMdsScopeDir("session", resolvedDataDir, undefined, q.sessionId);

    if (globalPath) await ensureDefaultMdsDirs(globalPath, mode);
    if (projectPath) await ensureDefaultMdsDirs(projectPath, mode);
    if (sessionPath) await ensureDefaultMdsDirs(sessionPath, mode);

    const project = projectPath
      ? { available: true as const, path: projectPath, tree: await walkDir(projectPath), tags: await collectScopeTags(projectPath), items: await listScopeItems(projectPath) }
      : { available: false as const, reason: "no workspace selected" };
    const sessionScope = sessionPath
      ? { available: true as const, path: sessionPath, tree: await walkDir(sessionPath), tags: await collectScopeTags(sessionPath), items: await listScopeItems(sessionPath) }
      : { available: false as const, reason: "not in a session" };

    return {
      mode,
      dataDirSource: source,
      dataDir: resolvedDataDir,
      workspaceRoot: wsRoot ? resolve(wsRoot) : null,
      sessionId: q.sessionId || null,
      scopes: {
        global: { available: true as const, path: globalPath, tree: await walkDir(globalPath), tags: await collectScopeTags(globalPath), items: await listScopeItems(globalPath) },
        project,
        session: sessionScope,
      },
    };
  });

  app.post("/api/mds/scope-mkdir", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { scope?: string; name?: string };
    const scope = body.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(body.name);
    if (!rel) return reply.code(400).send({ error: "invalid folder name" });
    if (RESERVED_MDS_DIRS.has(rel)) {
      return reply.code(400).send({ error: `"${rel}" is a reserved folder name` });
    }

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const target = join(base, rel);
    if (!target.startsWith(base)) {
      return reply.code(400).send({ error: "path outside scope" });
    }
    await mkdir(target, { recursive: true });
    return { ok: true, path: target };
  });

  app.put("/api/mds/scope-rename", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { scope?: string; from?: string; to?: string };
    const scope = body.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const fromRel = safeRelPath(body.from);
    const toRel = safeRelPath(body.to);
    if (!fromRel || !toRel) return reply.code(400).send({ error: "invalid paths" });
    if (fromRel === toRel) return reply.code(400).send({ error: "source and target are the same" });
    if (RESERVED_MDS_DIRS.has(fromRel)) {
      return reply.code(400).send({ error: `"${fromRel}" is a reserved folder and cannot be renamed` });
    }

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const from = join(base, fromRel);
    const to = join(base, toRel);
    if (!from.startsWith(base) || !to.startsWith(base)) {
      return reply.code(400).send({ error: "path outside scope" });
    }
    try {
      await rename(from, to);
    } catch (err) {
      return reply.code(400).send({ error: `rename failed: ${err instanceof Error ? err.message : String(err)}` });
    }
    return { ok: true, path: to };
  });

  app.post("/api/mds/scope-create-md", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { scope?: string; name?: string };
    const scope = body.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(body.name);
    if (!rel) return reply.code(400).send({ error: "invalid name" });
    if (RESERVED_MDS_DIRS.has(rel)) {
      return reply.code(400).send({ error: `"${rel}" is a reserved folder name` });
    }

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const folder = join(base, rel);
    if (!folder.startsWith(base)) {
      return reply.code(400).send({ error: "path outside scope" });
    }
    const mdPath = join(folder, "prompt.md");
    const jsonPath = join(folder, "prompt.json");
    if (existsSync(mdPath) || existsSync(jsonPath)) {
      return reply.code(409).send({ error: "a prompt.md/prompt.json already exists there" });
    }
    const name = rel.split("/").pop() || rel;
    const now = new Date().toISOString();
    await mkdir(folder, { recursive: true });
    await writeFile(mdPath, `# ${name}

`, "utf-8");
    await writeFile(
      jsonPath,
      JSON.stringify({ createdAt: now, updatedAt: now, tags: [] }, null, 2) + "\n",
      "utf-8"
    );
    return { ok: true, path: folder };
  });

  /** Resolve the global system prompt base + project AGENTS.md paths for the editor (AGENTS.md is separate from MDS items). */
  app.get("/api/mds/agents-paths", async (request) => {
    const q = request.query as { sessionId?: string };
    const { dataDir: resolvedDataDir } = resolveDataDirInfo();
    let wsRoot = "";
    if (q.sessionId) {
      const session = await getSession(resolvedDataDir, q.sessionId);
      if (session) wsRoot = session.meta.workspaceRoot || "";
    }
    const globalBase = globalSystemPromptPath(resolvedDataDir);
    const workspaceAgents = wsRoot ? (await listAgentsMdAtRoot(wsRoot))[0] ?? null : null;
    return { globalBase, workspaceAgents, workspaceRoot: wsRoot ? resolve(wsRoot) : null };
  });

  app.get("/api/mds/scope-read-file", async (request, reply) => {
    const q = request.query as { scope?: string; path?: string; sessionId?: string; workspaceRoot?: string };
    const scope = q.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(q.path);
    if (!rel) return reply.code(400).send({ error: "invalid path" });

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const target = join(base, rel);
    if (!target.startsWith(base)) return reply.code(400).send({ error: "path outside scope" });
    try {
      const content = await readFile(target, "utf-8");
      return { content };
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }
  });

  app.put("/api/mds/scope-write-file", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { scope?: string; path?: string; content?: string };
    const scope = body.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(body.path);
    if (!rel) return reply.code(400).send({ error: "invalid path" });
    if (body.content === undefined) return reply.code(400).send({ error: "content required" });

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const target = join(base, rel);
    if (!target.startsWith(base)) return reply.code(400).send({ error: "path outside scope" });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body.content, "utf-8");
    // Editing anything in a prompt folder refreshes that folder's prompt.json updatedAt.
    await bumpPromptJson(dirname(target));
    return { ok: true, path: target };
  });

  app.delete("/api/mds/scope-delete", async (request, reply) => {
    const q = request.query as { scope?: string; path?: string; sessionId?: string; workspaceRoot?: string };
    const scope = q.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(q.path);
    if (!rel) return reply.code(400).send({ error: "invalid path" });
    if (RESERVED_MDS_DIRS.has(rel)) {
      return reply.code(400).send({ error: `"${rel}" is a reserved folder and cannot be deleted` });
    }

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const base = resolveMdsScopeDir(scope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!base) {
      return reply.code(400).send({
        error: scope === "project" ? "no workspace selected" : "not in a session",
      });
    }
    const target = join(base, rel);
    if (!target.startsWith(base) || target === base) {
      return reply.code(400).send({ error: "cannot delete scope root" });
    }
    try {
      const info = await stat(target);
      if (!info.isDirectory()) {
        return reply.code(400).send({ error: "only folders can be deleted" });
      }
      await rm(target, { recursive: true, force: true });
    } catch {
      return reply.code(404).send({ error: "folder not found" });
    }
    return { ok: true, path: target };
  });

  app.get("/api/mds/read", async (request, reply) => {
    const q = request.query as { path?: string };
    if (!q.path) return reply.code(400).send({ error: "file path required" });

    try {
      await stat(q.path);
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }
    const content = await readFile(q.path, "utf-8");
    return { content };
  });






}
