import type { FastifyInstance } from "fastify";
import { join, resolve, extname, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile, stat, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getSession } from "../storage/session";
import { resolveDataDirInfo, getMode } from "../paths";
import { projectScopedMdsDir, resolveMdsScopeDir, seedsDir, globalSystemPromptPath } from "../features/mds/paths";
import { listAgentsMdAtRoot } from "../features/mds/reader";

export interface ScopeDirNode {
  name: string;
  type: "file" | "dir";
  ext: string;
  children: ScopeDirNode[];
  /** true when this dir is an MDS item folder (contains prompt.md) */
  isItem?: boolean;
}

/**
 * Collect unique tags across all prompt.json files under `dir` (recursive).
 */
async function collectScopeTags(dir: string): Promise<string[]> {
  const tags = new Set<string>();
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name === "prompt.json") {
        try {
          const raw = await readFile(full, "utf-8");
          const parsed = JSON.parse(raw) as { tags?: unknown };
          if (Array.isArray(parsed.tags)) {
            for (const t of parsed.tags) {
              if (typeof t === "string" && t.trim()) tags.add(t.trim());
            }
          }
        } catch {
          // unreadable prompt.json — skip
        }
      }
    }
  }
  await walk(dir);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export interface ScopeItem {
  name: string;
  relPath: string;
  path: string;
  promptPath: string;
  tags: string[];
}

/**
 * List MDS item folders (dirs containing prompt.md) under `dir`, recursively.
 * Item tags come from each item's own prompt.json (not from folder location).
 */
async function listScopeItems(dir: string): Promise<ScopeItem[]> {
  const items: ScopeItem[] = [];
  async function walk(d: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(d, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const mdPath = join(full, "prompt.md");
      const jsonPath = join(full, "prompt.json");
      if (existsSync(mdPath)) {
        let tags: string[] = [];
        try {
          const raw = await readFile(jsonPath, "utf-8");
          const parsed = JSON.parse(raw) as { tags?: unknown };
          tags = Array.isArray(parsed.tags)
            ? parsed.tags.filter((t): t is string => typeof t === "string")
            : [];
        } catch {
          // no prompt.json — no tags
        }
        items.push({ name: e.name, relPath: childRel, path: full, promptPath: mdPath, tags });
      } else {
        await walk(full, childRel);
      }
    }
  }
  await walk(dir, "");
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Walk a directory recursively, returning a full tree (dirs first, then files, alphabetical). */
async function walkDir(dir: string): Promise<ScopeDirNode[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nodes: ScopeDirNode[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          type: "dir",
          ext: "",
          isItem: existsSync(join(dir, e.name, "prompt.md")),
          children: await walkDir(join(dir, e.name)),
        });
      } else if (e.isFile()) {
        const ext = extname(e.name).replace(/^\./, "").toLowerCase();
        nodes.push({ name: e.name, type: "file", ext, children: [] });
      }
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

/**
 * Bump `updatedAt` in the prompt.json inside `folder` (if it exists).
 * Preserves every other field. Safe when the edited file IS prompt.json.
 */
async function bumpPromptJson(folder: string): Promise<void> {
  const jsonPath = join(folder, "prompt.json");
  if (!existsSync(jsonPath)) return;
  try {
    const raw = await readFile(jsonPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data.updatedAt = new Date().toISOString();
    await writeFile(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn(
      `[mds] failed to bump prompt.json ${jsonPath}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/** Reserved top-level MDS dirs — auto-created in every scope, protected from delete/rename. */
const RESERVED_MDS_DIRS = new Set(["_skills", "_SystemBase"]);

/** Ensure the default reserved folders exist in a scope dir (global / project / session). */
async function ensureDefaultMdsDirs(dir: string): Promise<void> {
  for (const name of RESERVED_MDS_DIRS) {
    await mkdir(join(dir, name), { recursive: true });
  }
  // Seed _SystemBase/prompt.md from the repo seeds when available (fresh installs only).
  const base = join(dir, "_SystemBase", "prompt.md");
  if (!existsSync(base)) {
    const sDir = seedsDir();
    if (sDir) {
      try {
        const seed = await readFile(join(sDir, "dev", "mds", "systemPromptBase.md"), "utf-8");
        await writeFile(base, seed, "utf-8");
      } catch {
        // no seed file — leave _SystemBase empty
      }
    }
  }
}

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

    if (globalPath) await ensureDefaultMdsDirs(globalPath);
    if (projectPath) await ensureDefaultMdsDirs(projectPath);
    if (sessionPath) await ensureDefaultMdsDirs(sessionPath);

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

  /** Validate a relative path: no `..`, no traversal, no empty segments. Returns normalized path or null. */
  function safeRelPath(rel: string | undefined): string | null {
    if (!rel) return null;
    const normalized = rel.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.length > 200) return null;
    const segments = normalized.split("/");
    if (segments.some((s) => !s || s === "." || s === "..")) return null;
    return normalized;
  }

  async function resolveMdsContext(q: { sessionId?: string; workspaceRoot?: string }) {
    const { dataDir: resolvedDataDir } = resolveDataDirInfo();
    let wsRoot = (q.workspaceRoot || "").trim();
    if (q.sessionId) {
      const session = await getSession(resolvedDataDir, q.sessionId);
      if (session?.meta?.workspaceRoot) wsRoot = session.meta.workspaceRoot;
    }
    return { resolvedDataDir, wsRoot };
  }

  app.post("/api/mds/scope-mkdir", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { scope?: string; name?: string };
    const scope = body.scope as "global" | "project" | "session";
    if (scope !== "global" && scope !== "project" && scope !== "session") {
      return reply.code(400).send({ error: "invalid scope" });
    }
    const rel = safeRelPath(body.name);
    if (!rel) return reply.code(400).send({ error: "invalid folder name" });

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
