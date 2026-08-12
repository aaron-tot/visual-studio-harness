import type { FastifyInstance } from "fastify";
import { join, dirname, resolve } from "node:path";
import { mkdir, writeFile, stat, rename, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getSession } from "../storage/session";
import { resolveDataDirInfo, getMode } from "../paths";
import { resolveMdsScopeDir, globalSystemPromptPath, projectAgentsMdPath } from "../features/mds/paths";
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
  copyRecursive,
  updateMdsPathPrefix,
} from "../features/mds/scope";
import { seedsDir, seedSubdirForMode } from "../features/mds/paths";

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

    // Update every path stored in config.json that references the moved folder.
    const configPath = join(resolvedDataDir, "config.json");
    try {
      const configRaw = await readFile(configPath, "utf-8");
      const config = JSON.parse(configRaw) as Record<string, unknown>;
      const agents = config.agents as Record<string, Record<string, unknown>> | undefined;
      if (agents && typeof agents === "object") {
        let changed = false;
        const oldPrefix = join(base, fromRel);
        const newPrefix = join(base, toRel);
        for (const key of Object.keys(agents)) {
          const a = agents[key];
          if (!a || typeof a !== "object") continue;
          // agentMd.path
          const amd = a.agentMd as Record<string, unknown> | undefined;
          if (amd?.path && typeof amd.path === "string" && amd.path.startsWith(oldPrefix)) {
            amd.path = amd.path.replace(oldPrefix, newPrefix);
            changed = true;
          }
          // skillMds[].path
          const skills = a.skillMds as Record<string, unknown>[] | undefined;
          if (Array.isArray(skills)) {
            for (const sk of skills) {
              if (sk.path && typeof sk.path === "string" && sk.path.startsWith(oldPrefix)) {
                sk.path = sk.path.replace(oldPrefix, newPrefix);
                changed = true;
              }
            }
          }
        }
        if (changed) {
          await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
          console.log(`[mds] auto-updated config paths for moved folder: ${fromRel} -> ${toRel}`);
        }
      }
    } catch {
      // Config update is best-effort — don't fail the rename if config write fails.
    }

    // Update paths in config.json + agent files referencing the moved folder.
    await updateMdsPathPrefix(resolvedDataDir, join(base, fromRel), join(base, toRel));

    return { ok: true, path: to };
  });

  app.post("/api/mds/scope-transfer", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { fromScope?: string; relPath?: string; toScope?: string };
    const fromScope = body.fromScope as "global" | "project" | "session";
    const toScope = body.toScope as "global" | "project" | "session";
    if (!["global", "project", "session"].includes(fromScope) || !["global", "project", "session"].includes(toScope)) {
      return reply.code(400).send({ error: "invalid scope" });
    }
    if (fromScope === toScope) return reply.code(400).send({ error: "from and to scopes are the same" });
    const fromRel = safeRelPath(body.relPath);
    if (!fromRel) return reply.code(400).send({ error: "invalid path" });
    if (RESERVED_MDS_DIRS.has(fromRel)) {
      return reply.code(400).send({ error: `"${fromRel}" is a reserved folder and cannot be transferred` });
    }

    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const fromBase = resolveMdsScopeDir(fromScope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    const toBase = resolveMdsScopeDir(toScope, resolvedDataDir, wsRoot || undefined, q.sessionId);
    if (!fromBase) return reply.code(400).send({ error: `source scope "${fromScope}" not available` });
    if (!toBase) return reply.code(400).send({ error: `target scope "${toScope}" not available` });

    const from = join(fromBase, fromRel);
    if (!from.startsWith(fromBase)) return reply.code(400).send({ error: "path outside scope" });

    // Determine target relPath: if parent container exists in target, preserve nesting
    const parentRel = dirname(fromRel);
    const name = fromRel.split("/").pop() || fromRel;
    const toRel = (parentRel !== "." && existsSync(join(toBase, parentRel)))
      ? fromRel
      : name;
    const to = join(toBase, toRel);
    if (!to.startsWith(toBase)) return reply.code(400).send({ error: "target outside scope" });
    if (existsSync(to)) return reply.code(409).send({ error: "target already exists" });

    try {
      await copyRecursive(from, to);
      await rm(from, { recursive: true, force: true });
    } catch (err) {
      return reply.code(400).send({ error: `transfer failed: ${err instanceof Error ? err.message : String(err)}` });
    }

    // Update paths in the main data dir's config.json and agent files
    await updateMdsPathPrefix(resolvedDataDir, from, to);

    return { ok: true, fromPath: from, toPath: to };
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
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const { resolvedDataDir, wsRoot } = await resolveMdsContext(q);
    const globalBase = globalSystemPromptPath(resolvedDataDir);
    const workspaceAgents = wsRoot ? (await listAgentsMdAtRoot(wsRoot))[0] ?? null : null;
    return { globalBase, workspaceAgents, workspaceRoot: wsRoot ? resolve(wsRoot) : null };
  });

  /** Project-scope AGENTS.md (workspace root). Resolves the existing agents.md/AGENTS.md file, else the canonical create path. */
  app.get("/api/mds/agents-file", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const { wsRoot } = await resolveMdsContext(q);
    if (!wsRoot) return reply.code(400).send({ error: "no workspace selected" });

    const existing = (await listAgentsMdAtRoot(wsRoot))[0];
    const path = existing ?? projectAgentsMdPath(wsRoot);
    let content = "";
    if (existing) {
      try {
        content = await readFile(existing, "utf-8");
      } catch {
        return reply.code(404).send({ error: "AGENTS.md exists but could not be read" });
      }
    }
    return { path, exists: Boolean(existing), content };
  });

  /** Write the project-scope AGENTS.md (creates the canonical file when missing). */
  app.put("/api/mds/agents-file", async (request, reply) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const body = (request.body || {}) as { content?: string };
    if (typeof body.content !== "string") return reply.code(400).send({ error: "content required" });

    const { wsRoot } = await resolveMdsContext(q);
    if (!wsRoot) return reply.code(400).send({ error: "no workspace selected" });

    const existing = (await listAgentsMdAtRoot(wsRoot))[0];
    const path = existing ?? projectAgentsMdPath(wsRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body.content, "utf-8");
    return { ok: true, path };
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

  /**
   * POST /api/mds/seed-skills
   * Re-seed builtin tool skill guides (skill.md + prompt.json) from repo seeds
   * into data/tools/builtin/<name>/, overwriting same-named guide files. The old
   * `_tools` per-scope seeding was removed with the unified-tools migration —
   * tool guides now live in the tool folders (seeded on first run by
   * seedBuiltinToolFolders; this endpoint is the explicit re-generate path).
   * Returns: { seeded: string[], overwritten: string[], errors: string[] }
   */
  app.post("/api/mds/seed-skills", async (request, reply) => {
    const { resolvedDataDir } = await resolveMdsContext(
      request.query as { sessionId?: string; workspaceRoot?: string }
    );
    const mode = getMode();
    const sDir = seedsDir();
    if (!sDir) {
      return reply.code(500).send({ error: "seeds directory not available" });
    }

    const seedToolsDir = join(sDir, seedSubdirForMode(mode), "builtin-tools");
    const builtinRoot = join(resolvedDataDir, "tools", "builtin");

    const seeded: string[] = [];
    const overwritten: string[] = [];
    const errors: string[] = [];

    let seedEntries;
    try {
      seedEntries = await readdir(seedToolsDir, { withFileTypes: true });
    } catch {
      seedEntries = [];
    }

    for (const e of seedEntries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const seedMd = join(seedToolsDir, name, "skill.md");
      if (!existsSync(seedMd)) continue; // no guide for this builtin

      const targetSkillDir = join(builtinRoot, name);
      const targetMd = join(targetSkillDir, "skill.md");
      const targetJson = join(targetSkillDir, "prompt.json");
      const existed = existsSync(targetMd);

      try {
        await mkdir(targetSkillDir, { recursive: true });
        await writeFile(targetMd, await readFile(seedMd, "utf-8"), "utf-8");
        const seedJson = join(seedToolsDir, name, "prompt.json");
        if (existsSync(seedJson)) {
          await writeFile(targetJson, await readFile(seedJson, "utf-8"), "utf-8");
        }
        if (existed) overwritten.push(`builtin/${name}`);
        else seeded.push(`builtin/${name}`);
      } catch (err) {
        errors.push(`builtin/${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { seeded, overwritten, errors };
  });
}
