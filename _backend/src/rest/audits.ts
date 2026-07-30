import type { FastifyInstance } from "fastify";
import { join, resolve } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AuditDocument } from "../../../_shared/types/audit";

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

async function readAuditDocument(dir: string): Promise<AuditDocument | null> {
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
  await mkdir(nd, { recursive: true });
  await writeFile(
    join(nd, "audit.json"),
    JSON.stringify(params.document, null, 2) + "\n"
  );
  return { path: nd };
}

export async function editAudit(
  params: CreateAuditParams & { name: string }
): Promise<{ path: string }> {
  // Re-use createAudit — same dir resolution, write overwrites file
  return createAudit(params);
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
    const sc = (scope as AuditScope) || "global";
    if (sc === "project" && !workspaceRoot?.trim()) {
      return reply
        .code(400)
        .send({ error: "workspaceRoot is required for project scope" });
    }
    if (sc === "session" && !sessionId?.trim()) {
      return reply
        .code(400)
        .send({ error: "sessionId is required for session scope" });
    }
    const result = await createAudit({
      name: name.trim(),
      document,
      dataDir,
      scope: sc,
      workspaceRoot,
      sessionId,
    });
    return { ok: true, ...result };
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
    const sc = (scope as AuditScope) || "global";
    if (sc === "project" && !workspaceRoot?.trim()) {
      return reply.code(400).send({ error: "workspaceRoot is required for project scope" });
    }
    if (sc === "session" && !sessionId?.trim()) {
      return reply.code(400).send({ error: "sessionId is required for session scope" });
    }
    // Ensure the audit directory exists before overwriting
    const auditsDir = resolveAuditsDir(dataDir, sc, workspaceRoot, sessionId);
    if (!auditsDir) {
      return reply.code(400).send({ error: "Invalid scope" });
    }
    const nd = join(auditsDir, name.trim());
    await mkdir(nd, { recursive: true });
    await writeFile(join(nd, "audit.json"), JSON.stringify(document, null, 2) + "\n");
    return { ok: true, path: nd };
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
    const sc = (scope as AuditScope) || "global";
    const auditsDir = resolveAuditsDir(dataDir, sc, workspaceRoot, sessionId);
    if (!auditsDir) {
      return reply.code(400).send({
        error:
          sc === "project"
            ? "workspaceRoot is required for project scope"
            : "sessionId is required for session scope",
      });
    }
    const pd = join(auditsDir, name);
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
    const sc = (scope as AuditScope) || "global";
    const auditsDir = resolveAuditsDir(dataDir, sc, workspaceRoot, sessionId);
    if (!auditsDir) {
      return reply.code(400).send({
        error:
          sc === "project"
            ? "workspaceRoot is required for project scope"
            : "sessionId is required for session scope",
      });
    }
    const nd = join(auditsDir, name);
    if (!existsSync(nd)) {
      return reply.code(404).send({ error: "audit not found" });
    }
    await rm(nd, { recursive: true, force: true });
    return { ok: true };
  });
}
