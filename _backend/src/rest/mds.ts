import type { FastifyInstance } from "fastify";
import { join, resolve, relative, extname, dirname } from "node:path";
import { mkdir, readFile, readdir, writeFile, unlink, stat } from "node:fs/promises";
import { getSession } from "../storage/session";
import type { MdMetaFile, MdStats } from "../../_shared/types";

interface MdListEntry {
  path: string;
  fullPath: string;
  tags: string[];
  lastEdited: string | null;
  stats?: MdStats;
}

interface MdListResult {
  entries: Record<string, MdListEntry[]>;
}

function mdsDir(dataDir: string): string {
  return join(dataDir, "mds");
}

function metaPath(dataDir: string): string {
  return join(mdsDir(dataDir), "mdMeta.json");
}

function calculateStats(content: string): MdStats {
  const chars = content.length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const lines = content ? content.split("\n").length : 0;
  const tokens = Math.ceil(chars / 4);
  return { chars, words, lines, tokens };
}

async function readMeta(dataDir: string): Promise<MdMetaFile> {
  try {
    const raw = await readFile(metaPath(dataDir), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { entries: {} };
  }
}

async function writeMeta(dataDir: string, meta: MdMetaFile): Promise<void> {
  await mkdir(mdsDir(dataDir), { recursive: true });
  await writeFile(metaPath(dataDir), JSON.stringify(meta, null, 2) + "\n");
}

async function scanRecursiveMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function scan(d: string, base: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await scan(full, base);
      } else if (e.isFile() && extname(e.name).toLowerCase() === ".md") {
        results.push(relative(base, full));
      }
    }
  }
  await scan(dir, dir);
  return results.sort();
}

async function scanFlatMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.isFile() && extname(e.name).toLowerCase() === ".md") {
      results.push(e.name);
    }
  }
  return results.sort();
}

async function reconcile(
  dataDir: string,
  workspaceRoot: string
): Promise<MdListResult> {
  const mode = resolve(dataDir).split("/").pop() || "dev";
  const dataKey = `data.${mode}`;
  const meta = await readMeta(dataDir);
  const mds = mdsDir(dataDir);
  const wsRoot = workspaceRoot ? resolve(workspaceRoot) : "";

  const onDiskData = await scanRecursiveMd(mds);
  const onDiskWorkspace = wsRoot ? await scanFlatMd(wsRoot) : [];

  const existingData = meta.entries[dataKey] || [];
  const existingWorkspace = meta.entries["workspace"] || [];

  const updatedData: MdListEntry[] = [];
  const seenData = new Set<string>();
  for (const relPath of onDiskData) {
    seenData.add(relPath);
    const fullPath = join(mds, relPath);
    let stats: MdStats | undefined;
    try {
      const content = await readFile(fullPath, "utf-8");
      stats = calculateStats(content);
    } catch {
      // File read failed, skip stats
    }
    const existing = existingData.find((e) => e.path === relPath);
    if (existing) {
      updatedData.push({ ...existing, fullPath, stats });
    } else {
      const tags: string[] = [];
      if (relPath === "global/agents.md") tags.push("global");
      updatedData.push({ path: relPath, fullPath, tags, lastEdited: null, stats });
    }
  }

  const updatedWorkspace: MdListEntry[] = [];
  const seenWs = new Set<string>();
  for (const name of onDiskWorkspace) {
    seenWs.add(name);
    const fullPath = join(wsRoot, name);
    let stats: MdStats | undefined;
    try {
      const content = await readFile(fullPath, "utf-8");
      stats = calculateStats(content);
    } catch {
      // File read failed, skip stats
    }
    const existing = existingWorkspace.find((e) => e.path === name);
    if (existing) {
      updatedWorkspace.push({ ...existing, fullPath, stats });
    } else {
      updatedWorkspace.push({ path: name, fullPath, tags: [], lastEdited: null, stats });
    }
  }

  const reconciled: MdMetaFile = {
    entries: {
      [dataKey]: updatedData.map(({ fullPath: _, ...rest }) => rest),
      workspace: updatedWorkspace.map(({ fullPath: _, ...rest }) => rest),
    },
  };

  await writeMeta(dataDir, reconciled);

  return {
    entries: {
      [dataKey]: updatedData,
      workspace: updatedWorkspace,
    },
  };
}

export function registerMdsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/mds", async (request, reply) => {
    const q = request.query as { sessionId?: string };
    let workspaceRoot = "";
    if (q.sessionId) {
      const session = await getSession(dataDir, q.sessionId);
      if (session) workspaceRoot = session.meta.workspaceRoot || "";
    }
    const result = await reconcile(dataDir, workspaceRoot);
    return { ...result, roots: { mds: resolve(mdsDir(dataDir)), workspace: workspaceRoot ? resolve(workspaceRoot) : "" } };
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

  app.post("/api/mds/create", async (request, reply) => {
    const q = request.query as { sessionId?: string };
    const body = (request.body || {}) as { path?: string; content?: string; tags?: string[] };
    if (!q.sessionId || !body.path || body.content === undefined) {
      return reply.code(400).send({ error: "sessionId, path, content required" });
    }
    const session = await getSession(dataDir, q.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });

    const absPath = resolve(body.path);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, body.content, "utf-8");

    const meta = await readMeta(dataDir);
    const mode = resolve(dataDir).split("/").pop() || "dev";
    const dataKey = `data.${mode}`;
    const wsKey = "workspace";
    const wsRoot = session.meta.workspaceRoot ? resolve(session.meta.workspaceRoot) : "";
    const mdsRoot = resolve(mdsDir(dataDir));

    if (absPath.startsWith(mdsRoot)) {
      const relPath = relative(mdsRoot, absPath);
      const entries = meta.entries[dataKey] || [];
      const tags = body.tags?.length ? body.tags : [];
      entries.push({ path: relPath, tags, lastEdited: new Date().toISOString() });
      meta.entries[dataKey] = entries;
    } else if (wsRoot && absPath.startsWith(wsRoot)) {
      const name = relative(wsRoot, absPath);
      const entries = meta.entries[wsKey] || [];
      const tags = body.tags?.length ? body.tags : [];
      entries.push({ path: name, tags, lastEdited: new Date().toISOString() });
      meta.entries[wsKey] = entries;
    }
    await writeMeta(dataDir, meta);

    return { ok: true };
  });

  app.put("/api/mds/update", async (request, reply) => {
    const q = request.query as { sessionId?: string };
    const body = (request.body || {}) as {
      path?: string;
      newPath?: string;
      content?: string;
      tags?: string[];
    };
    if (!q.sessionId || !body.path) {
      return reply.code(400).send({ error: "sessionId and path required" });
    }
    const session = await getSession(dataDir, q.sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });

    let currentPath = body.path;

    // Handle rename/move
    if (body.newPath && body.newPath !== body.path) {
      const absNewPath = resolve(body.newPath);
      await mkdir(dirname(absNewPath), { recursive: true });
      await writeFile(absNewPath, body.content !== undefined ? body.content : await readFile(body.path, "utf-8"), "utf-8");
      await unlink(body.path);
      currentPath = absNewPath;
    } else if (body.content !== undefined) {
      await writeFile(currentPath, body.content, "utf-8");
    }

    // Update meta tags
    const meta = await readMeta(dataDir);
    const mode = resolve(dataDir).split("/").pop() || "dev";
    const dataKey = `data.${mode}`;
    const wsKey = "workspace";
    const wsRoot = session.meta.workspaceRoot ? resolve(session.meta.workspaceRoot) : "";
    const mdsRoot = resolve(mdsDir(dataDir));

    // Remove old entry if renamed
    if (body.newPath && body.newPath !== body.path) {
      for (const key of [dataKey, wsKey]) {
        meta.entries[key] = (meta.entries[key] || []).filter((e) => {
          const entryFull = key === wsKey
            ? join(wsRoot, e.path)
            : join(mdsRoot, e.path);
          return entryFull !== body.path;
        });
      }
    }

    // Add/update entry for current path
    let found = false;
    for (const key of [dataKey, wsKey]) {
      const entries = meta.entries[key] || [];
      for (const entry of entries) {
        const entryFull = key === wsKey
          ? join(wsRoot, entry.path)
          : join(mdsRoot, entry.path);
        if (entryFull === currentPath) {
          if (body.tags !== undefined) entry.tags = body.tags;
          entry.lastEdited = new Date().toISOString();
          found = true;
        }
      }
    }

    if (!found && body.newPath) {
      // New location — add entry
      if (currentPath.startsWith(mdsRoot)) {
        const relPath = relative(mdsRoot, currentPath);
        const entries = meta.entries[dataKey] || [];
        entries.push({ path: relPath, tags: body.tags ?? [], lastEdited: new Date().toISOString() });
        meta.entries[dataKey] = entries;
      } else if (wsRoot && currentPath.startsWith(wsRoot)) {
        const name = relative(wsRoot, currentPath);
        const entries = meta.entries[wsKey] || [];
        entries.push({ path: name, tags: body.tags ?? [], lastEdited: new Date().toISOString() });
        meta.entries[wsKey] = entries;
      }
    }

    await writeMeta(dataDir, meta);

    return { ok: true };
  });

  app.delete("/api/mds/delete", async (request, reply) => {
    const q = request.query as { sessionId?: string; path?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });

    try {
      await unlink(q.path);
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }

    const meta = await readMeta(dataDir);
    const mode = resolve(dataDir).split("/").pop() || "dev";
    const dataKey = `data.${mode}`;
    const wsKey = "workspace";
    let wsRoot = "";
    if (q.sessionId) {
      const session = await getSession(dataDir, q.sessionId);
      if (session) wsRoot = session.meta.workspaceRoot ? resolve(session.meta.workspaceRoot) : "";
    }
    for (const key of [dataKey, wsKey]) {
      meta.entries[key] = (meta.entries[key] || []).filter((e) => {
        const entryFull = key === wsKey
          ? join(wsRoot, e.path)
          : join(mdsDir(dataDir), e.path);
        return entryFull !== q.path;
      });
    }
    await writeMeta(dataDir, meta);

    return { ok: true };
  });
}
