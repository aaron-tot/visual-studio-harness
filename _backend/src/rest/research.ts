import type { FastifyInstance } from "fastify";
import { join, resolve } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ResearchDoc } from "../../../_shared/types/research";

export type ResearchScope = "global" | "project" | "session";

export function resolveResearchDir(
  dataDir: string,
  scope: ResearchScope | undefined,
  workspaceRoot?: string,
  sessionId?: string
): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return join(resolve(workspaceRoot), ".agentHarness", "research");
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "research");
    default:
      return join(dataDir, "research");
  }
}

export interface ResearchEntry {
  name: string;
  path: string;
  document: ResearchDoc;
}

async function readResearchDocument(dir: string): Promise<ResearchDoc | null> {
  try {
    const raw = await readFile(join(dir, "research.json"), "utf-8");
    return JSON.parse(raw) as ResearchDoc;
  } catch {
    return null;
  }
}

export async function listResearch(
  dataDir: string,
  scope: ResearchScope = "global",
  workspaceRoot?: string,
  sessionId?: string
): Promise<ResearchEntry[]> {
  const dir = resolveResearchDir(dataDir, scope, workspaceRoot, sessionId);
  if (!dir || !existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const results: ResearchEntry[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pd = join(dir, e.name);
    const doc = await readResearchDocument(pd);
    if (!doc) continue;
    results.push({ name: e.name, path: pd, document: doc });
  }

  return results.sort(
    (a, b) =>
      new Date(b.document.meta.createdAt).getTime() -
      new Date(a.document.meta.createdAt).getTime()
  );
}

/** Batch list research for multiple workspace roots (project scope) or session IDs (session scope).
 *  Returns a map keyed by workspaceRoot/sessionId to ResearchEntry[]. */
export async function listResearchBatch(
  dataDir: string,
  scope: ResearchScope,
  workspaceRoots?: string[],
  sessionIds?: string[]
): Promise<Map<string, ResearchEntry[]>> {
  const results = new Map<string, ResearchEntry[]>();

  if (scope === "project" && workspaceRoots?.length) {
    await Promise.all(
      workspaceRoots.map(async (root) => {
        const docs = await listResearch(dataDir, "project", root);
        results.set(root, docs);
      })
    );
    return results;
  }

  if (scope === "session" && sessionIds?.length) {
    await Promise.all(
      sessionIds.map(async (sid) => {
        const docs = await listResearch(dataDir, "session", undefined, sid);
        results.set(sid, docs);
      })
    );
    return results;
  }

  // Global scope - just return single entry
  const docs = await listResearch(dataDir, "global");
  results.set("global", docs);
  return results;
}

export interface CreateResearchParams {
  name: string;
  document: ResearchDoc;
  dataDir: string;
  scope?: ResearchScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function createResearch(params: CreateResearchParams): Promise<{ path: string }> {
  const scope = params.scope || "global";
  const researchDir = resolveResearchDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!researchDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project research"
        : scope === "session"
          ? "sessionId is required for session research"
          : "invalid research scope"
    );
  }

  const nd = join(researchDir, params.name);
  await mkdir(nd, { recursive: true });
  await writeFile(join(nd, "research.json"), JSON.stringify(params.document, null, 2) + "\n");
  return { path: nd };
}

export async function updateResearch(
  params: CreateResearchParams
): Promise<{ path: string }> {
  // Same as create — write overwrites the file
  return createResearch(params);
}

export async function deleteResearch(
  name: string,
  dataDir: string,
  scope?: ResearchScope,
  workspaceRoot?: string,
  sessionId?: string
): Promise<void> {
  const researchDir = resolveResearchDir(dataDir, scope, workspaceRoot, sessionId);
  if (!researchDir) throw new Error("Invalid research scope or missing parameters");
  const nd = join(researchDir, name);
  await rm(nd, { recursive: true, force: true });
}

function validateScope(
  scope: string | undefined,
  workspaceRoot: string | undefined,
  sessionId: string | undefined,
  dataDir: string,
  reply: { code: (status: number) => { send: (body: object) => void } }
): { sc: ResearchScope; researchDir: string } | null {
  const sc = (scope as ResearchScope) || "global";
  if (sc === "project" && !workspaceRoot?.trim()) {
    reply.code(400).send({ error: "workspaceRoot is required for project scope" });
    return null;
  }
  if (sc === "session" && !sessionId?.trim()) {
    reply.code(400).send({ error: "sessionId is required for session scope" });
    return null;
  }
  const researchDir = resolveResearchDir(dataDir, sc, workspaceRoot, sessionId);
  if (!researchDir) {
    reply.code(400).send({
      error:
        sc === "project"
          ? "workspaceRoot is required for project scope"
          : "sessionId is required for session scope",
    });
    return null;
  }
  return { sc, researchDir };
}

export function registerResearchRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/research", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string; sessionId?: string };
    const scope = (q.scope as ResearchScope) || "global";
    return listResearch(dataDir, scope, q.workspaceRoot, q.sessionId);
  });

  app.post<{
    Body: {
      name: string;
      document: ResearchDoc;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/research/create", async (request, reply) => {
    const { name, document, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!document?.meta) {
      return reply.code(400).send({ error: "document.meta is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const r = await createResearch({
      name: name.trim(),
      document,
      dataDir,
      scope: result.sc,
      workspaceRoot,
      sessionId,
    });
    return { ok: true, ...r };
  });

  app.put<{
    Body: {
      name: string;
      document: ResearchDoc;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/research/edit", async (request, reply) => {
    const { name, document, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!document?.meta) {
      return reply.code(400).send({ error: "document.meta is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const r = await updateResearch({
      name: name.trim(),
      document,
      dataDir,
      scope: result.sc,
      workspaceRoot,
      sessionId,
    });
    return { ok: true, ...r };
  });

  app.post<{
    Body: {
      name: string;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/research/read", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const pd = join(result.researchDir, name);
    if (!existsSync(pd)) {
      return reply.code(404).send({ error: "research not found" });
    }
    const doc = await readResearchDocument(pd);
    if (!doc) {
      return reply.code(404).send({ error: "research document not found" });
    }
    return { name, path: pd, document: doc };
  });

  app.post<{
    Body: {
      name: string;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/research/delete", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const nd = join(result.researchDir, name);
    if (!existsSync(nd)) {
      return reply.code(404).send({ error: "research not found" });
    }
    await deleteResearch(name, dataDir, result.sc, workspaceRoot, sessionId);
    return { ok: true };
  });

  app.post<{
    Body: { scope?: string; workspaceRoots?: string[]; sessionIds?: string[] };
  }>("/api/research/batch", async (request, reply) => {
    const { scope, workspaceRoots, sessionIds } = request.body;
    const sc = (scope as ResearchScope) || "global";
    if (sc === "project" && (!workspaceRoots?.length)) {
      return reply.code(400).send({ error: "workspaceRoots required for project scope" });
    }
    if (sc === "session" && (!sessionIds?.length)) {
      return reply.code(400).send({ error: "sessionIds required for session scope" });
    }
    const results = await listResearchBatch(dataDir, sc, workspaceRoots, sessionIds);
    // Convert Map to object for JSON serialization
    const obj: Record<string, ResearchEntry[]> = {};
    for (const [key, value] of results) obj[key] = value;
    return obj;
  });
}
