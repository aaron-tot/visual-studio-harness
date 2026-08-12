import type { FastifyInstance, FastifyReply } from "fastify";
import { join, resolve } from "node:path";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AuditDocument } from "../../../_shared/types/audit";
import { mkdirDurable, writeFileDurable } from "../utils/fs";
import { moveScopedDir, MoveError } from "./scope-move";

export type AuditScope = "global" | "project" | "session";

export function resolveAuditsDir(
  dataDir: string,
  scope: AuditScope | undefined,
  workspaceRoot?: string,
  sessionId?: string
): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return join(resolve(workspaceRoot), ".agentHarness", "audits");
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "audits");
    default:
      return join(dataDir, "audits");
  }
}

export interface AuditEntry {
  name: string;
  path: string;
  document: AuditDocument;
}

export async function readAuditDocument(dir: string): Promise<AuditDocument | null> {
  try {
    const raw = await readFile(join(dir, "audit.json"), "utf-8");
    return JSON.parse(raw) as AuditDocument;
  } catch {
    return null;
  }
}

export async function listAudits(
  dataDir: string,
  scope: AuditScope = "global",
  workspaceRoot?: string,
  sessionId?: string
): Promise<AuditEntry[]> {
  const dir = resolveAuditsDir(dataDir, scope, workspaceRoot, sessionId);
  if (!dir || !existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const results: AuditEntry[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pd = join(dir, e.name);
    const doc = await readAuditDocument(pd);
    if (!doc) continue;
    results.push({ name: e.name, path: pd, document: doc });
  }

  return results.sort(
    (a, b) =>
      new Date(b.document.meta.createdAt).getTime() -
      new Date(a.document.meta.createdAt).getTime()
  );
}

/** Batch list audits for multiple workspace roots (project scope) or session IDs (session scope).
 *  Returns a map keyed by workspaceRoot/sessionId to AuditEntry[]. */
export async function listAuditsBatch(
  dataDir: string,
  scope: AuditScope,
  workspaceRoots?: string[],
  sessionIds?: string[]
): Promise<Map<string, AuditEntry[]>> {
  const results = new Map<string, AuditEntry[]>();

  if (scope === "project" && workspaceRoots?.length) {
    await Promise.all(
      workspaceRoots.map(async (root) => {
        const audits = await listAudits(dataDir, "project", root);
        results.set(root, audits);
      })
    );
    return results;
  }

  if (scope === "session" && sessionIds?.length) {
    await Promise.all(
      sessionIds.map(async (sid) => {
        const audits = await listAudits(dataDir, "session", undefined, sid);
        results.set(sid, audits);
      })
    );
    return results;
  }

  // Global scope - just return single entry
  const audits = await listAudits(dataDir, "global");
  results.set("global", audits);
  return results;
}

export interface CreateAuditParams {
  name: string;
  document: AuditDocument;
  dataDir: string;
  scope?: AuditScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function createAudit(
  params: CreateAuditParams
): Promise<{ path: string }> {
  const scope = params.scope || "global";
  const auditsDir = resolveAuditsDir(
    params.dataDir,
    scope,
    params.workspaceRoot,
    params.sessionId
  );
  if (!auditsDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project audits"
        : scope === "session"
          ? "sessionId is required for session audits"
          : "invalid audit scope"
    );
  }

  const nd = join(auditsDir, params.name);
  await mkdirDurable(nd);
  await writeFileDurable(
    join(nd, "audit.json"),
    JSON.stringify(params.document, null, 2) + "\n"
  );
  return { path: nd };
}

/**
 * Locate which scope holds an audit directory by name.
 * Search order: session → project → global (most specific first).
 * Returns null when the audit does not exist in any resolvable scope.
 */
export async function findAuditScope(
  name: string,
  dataDir: string,
  workspaceRoot?: string,
  sessionId?: string
): Promise<AuditScope | null> {
  const candidates: AuditScope[] = [];
  if (sessionId) candidates.push("session");
  if (workspaceRoot) candidates.push("project");
  candidates.push("global");
  for (const scope of candidates) {
    const dir = resolveAuditsDir(dataDir, scope, workspaceRoot, sessionId);
    if (!dir) continue;
    if (existsSync(join(dir, name, "audit.json"))) return scope;
  }
  return null;
}

export async function editAudit(
  params: CreateAuditParams
): Promise<{ path: string; scope: AuditScope }> {
  // When scope is omitted, resolve from the existing document rather than
  // silently defaulting to global (which created duplicate global audits).
  let scope: AuditScope = params.scope || "global";
  if (!params.scope) {
    const found = await findAuditScope(
      params.name,
      params.dataDir,
      params.workspaceRoot,
      params.sessionId
    );
    if (!found) {
      throw new Error(
        `Audit "${params.name}" not found in session/project/global scopes. ` +
          `Pass scope explicitly to create, or use the correct name.`
      );
    }
    scope = found;
  }

  const auditsDir = resolveAuditsDir(
    params.dataDir,
    scope,
    params.workspaceRoot,
    params.sessionId
  );
  if (!auditsDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project audits"
        : scope === "session"
          ? "sessionId is required for session audits"
          : "invalid audit scope"
    );
  }

  const nd = join(auditsDir, params.name);
  const fp = join(nd, "audit.json");
  if (!existsSync(fp)) {
    throw new Error(
      `Audit "${params.name}" not found in "${scope}" scope. ` +
        `Use audit create to make a new one, or pass the correct scope.`
    );
  }

  // Keep document.meta.scope in sync with the resolved write target.
  if (params.document?.meta && typeof params.document.meta === "object") {
    (params.document.meta as { scope?: string }).scope = scope;
  }

  await writeFileDurable(fp, JSON.stringify(params.document, null, 2) + "\n");
  return { path: nd, scope };
}

export async function deleteAudit(
  name: string,
  dataDir: string,
  scope?: AuditScope,
  workspaceRoot?: string,
  sessionId?: string
): Promise<void> {
  const auditsDir = resolveAuditsDir(dataDir, scope, workspaceRoot, sessionId);
  if (!auditsDir) throw new Error("Invalid audit scope or missing parameters");
  const nd = join(auditsDir, name);
  await rm(nd, { recursive: true, force: true });
}

export interface MoveAuditParams {
  name: string;
  fromScope: AuditScope;
  toScope: AuditScope;
  dataDir: string;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function moveAudit(
  params: MoveAuditParams,
): Promise<{ fromPath: string; toPath: string; scope: AuditScope }> {
  const fromDir = resolveAuditsDir(params.dataDir, params.fromScope, params.workspaceRoot, params.sessionId);
  const toDir = resolveAuditsDir(params.dataDir, params.toScope, params.workspaceRoot, params.sessionId);
  if (!fromDir) throw new MoveError(`source scope "${params.fromScope}" not available`, 400);
  if (!toDir) throw new MoveError(`target scope "${params.toScope}" not available`, 400);
  const r = await moveScopedDir({ name: params.name, fromDir, toDir });
  const fp = join(r.toPath, "audit.json");
  try {
    const doc = JSON.parse(await readFile(fp, "utf-8")) as { meta?: Record<string, unknown> };
    if (doc.meta && typeof doc.meta === "object") doc.meta.scope = params.toScope;
    await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  } catch {
    // missing/unparseable audit.json — leave as-is
  }
  return { ...r, scope: params.toScope };
}

function validateScope(
  scope: string | undefined,
  workspaceRoot: string | undefined,
  sessionId: string | undefined,
  dir: string,
  reply: FastifyReply
): { sc: AuditScope; auditsDir: string } | null {
  const sc = (scope as AuditScope) || "global";
  if (sc === "project" && !workspaceRoot?.trim()) {
    reply.code(400).send({ error: "workspaceRoot is required for project scope" });
    return null;
  }
  if (sc === "session" && !sessionId?.trim()) {
    reply.code(400).send({ error: "sessionId is required for session scope" });
    return null;
  }
  const auditsDir = resolveAuditsDir(dir, sc, workspaceRoot, sessionId);
  if (!auditsDir) {
    reply.code(400).send({
      error:
        sc === "project"
          ? "workspaceRoot is required for project scope"
          : "sessionId is required for session scope",
    });
    return null;
  }
  return { sc, auditsDir };
}

export function registerAuditsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/audits", async (request) => {
    const q = request.query as {
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
    const scope = (q.scope as AuditScope) || "global";
    return listAudits(dataDir, scope, q.workspaceRoot, q.sessionId);
  });

  app.post<{
    Body: {
      name: string;
      document: AuditDocument;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/audits/create", async (request, reply) => {
    const { name, document, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!document?.meta) {
      return reply.code(400).send({ error: "document.meta is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const r = await createAudit({
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
      document: AuditDocument;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/audits/edit", async (request, reply) => {
    const { name, document, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!document?.meta) {
      return reply.code(400).send({ error: "document.meta is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const r = await editAudit({
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
  }>("/api/audits/read", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const pd = join(result.auditsDir, name);
    if (!existsSync(pd)) {
      return reply.code(404).send({ error: "audit not found" });
    }
    const doc = await readAuditDocument(pd);
    if (!doc) {
      return reply.code(404).send({ error: "audit document not found" });
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
  }>("/api/audits/delete", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const result = validateScope(scope, workspaceRoot, sessionId, dataDir, reply);
    if (!result) return;
    const nd = join(result.auditsDir, name);
    if (!existsSync(nd)) {
      return reply.code(404).send({ error: "audit not found" });
    }
    await deleteAudit(name, dataDir, result.sc, workspaceRoot, sessionId);
    return { ok: true };
  });

  app.post<{
    Body: {
      name: string;
      fromScope?: string;
      toScope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/audits/move", async (request, reply) => {
    const { name, fromScope, toScope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    const fs_ = (fromScope as AuditScope) || "global";
    const ts = (toScope as AuditScope) || "global";
    if (!["global", "project", "session"].includes(fs_) || !["global", "project", "session"].includes(ts)) {
      return reply.code(400).send({ error: "invalid scope" });
    }
    if (fs_ === ts) return reply.code(400).send({ error: "from and to scopes are the same" });
    try {
      const result = await moveAudit({ name: name.trim(), fromScope: fs_, toScope: ts, dataDir, workspaceRoot, sessionId });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof MoveError) return reply.code(err.code).send({ error: err.message });
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{
    Body: { scope?: string; workspaceRoots?: string[]; sessionIds?: string[] };
  }>("/api/audits/batch", async (request, reply) => {
    const { scope, workspaceRoots, sessionIds } = request.body;
    const sc = (scope as AuditScope) || "global";
    if (sc === "project" && (!workspaceRoots?.length)) {
      return reply.code(400).send({ error: "workspaceRoots required for project scope" });
    }
    if (sc === "session" && (!sessionIds?.length)) {
      return reply.code(400).send({ error: "sessionIds required for session scope" });
    }
    const results = await listAuditsBatch(dataDir, sc, workspaceRoots, sessionIds);
    // Convert Map to object for JSON serialization
    const obj: Record<string, AuditEntry[]> = {};
    for (const [key, value] of results) obj[key] = value;
    return obj;
  });
}
