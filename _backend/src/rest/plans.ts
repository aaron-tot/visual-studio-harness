import type { FastifyInstance } from "fastify";
import { join, resolve } from "node:path";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SpecDocument, PlanDocument, SpecPlanPart, CreatedBy } from "../../../../_shared/types";

export type DesignsScope = "global" | "project" | "session";

export function resolveDesignsDir(dataDir: string, scope: DesignsScope | undefined, workspaceRoot?: string, sessionId?: string): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return join(resolve(workspaceRoot), ".agentHarness", "designs");
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "designs");
    default:
      return join(dataDir, "designs");
  }
}

const SPEC_RE = /^specV(\d+)\.json$/;
const PLAN_RE = /^planV(\d+)\.json$/;

export interface DesignMeta {
  abandoned?: {
    reason: string;
    successor?: string;
    timestamp: string;
  };
}

export interface DesignEntry {
  name: string;
  path: string;
  files: string[];
  specs: SpecDocument[];
  plans: PlanDocument[];
  meta: DesignMeta;
}

async function nextVersion(dir: string, pattern: RegExp): Promise<number> {
  if (!existsSync(dir)) return 1;
  const entries = await readdir(dir);
  let max = 0;
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max + 1;
}

async function readVersions<T>(dir: string, pattern: RegExp): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const results: { version: number; doc: T }[] = [];
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) {
      const version = parseInt(m[1], 10);
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const doc = JSON.parse(raw) as T;
        results.push({ version, doc });
      } catch {}
    }
  }
  return results.sort((a, b) => a.version - b.version).map((r) => r.doc);
}

export interface CreateSpecParams {
  name: string;
  goal?: string;
  dataDir: string;
  scope?: DesignsScope;
  workspaceRoot?: string;
  sessionId?: string;
  createdBy: CreatedBy;
}

export async function createSpecDocument(params: CreateSpecParams): Promise<{ path: string; planDir: string; version: number }> {
  const scope = params.scope || "global";
  const designsDir = resolveDesignsDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!designsDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project designs"
        : scope === "session"
          ? "sessionId is required for session designs"
          : "invalid designs scope"
    );
  }
  const pd = join(designsDir, params.name);
  const version = await nextVersion(pd, SPEC_RE);
  const fp = join(pd, `specV${version}.json`);

  const now = new Date().toISOString();
  const doc: SpecDocument = {
    meta: {
      id: params.name,
      version,
      title: params.name,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy,
      status: "draft",
      relatedSpecs: [],
      createdMeta: {
        datetime: now,
        workspace: params.workspaceRoot || "",
        session: params.sessionId || "",
      },
    },
    goal: params.goal || "",
    requirements: [],
    constraints: [],
    assumptions: [],
    acceptanceCriteria: [],
    parts: [],
  };

  await mkdir(pd, { recursive: true });
  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  return { path: fp, planDir: pd, version };
}

export interface CreatePlanParams {
  name: string;
  endGoal: string;
  dataDir: string;
  scope?: DesignsScope;
  workspaceRoot?: string;
  sessionId?: string;
  createdBy: CreatedBy;
  specReference?: string;
}

export async function createPlanDocument(params: CreatePlanParams): Promise<{ path: string; planDir: string; version: number }> {
  const scope = params.scope || "global";
  const designsDir = resolveDesignsDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!designsDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project designs"
        : scope === "session"
          ? "sessionId is required for session designs"
          : "invalid designs scope"
    );
  }
  const pd = join(designsDir, params.name);
  const version = await nextVersion(pd, PLAN_RE);
  const fp = join(pd, `planV${version}.json`);

  const now = new Date().toISOString();
  const doc: PlanDocument = {
    meta: {
      id: params.name,
      version,
      mainSpec: params.specReference || "",
      relatedSpecs: [],
      title: params.name,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      createdBy: params.createdBy,
      status: "draft",
      tags: [],
      createdMeta: {
        datetime: now,
        workspace: params.workspaceRoot || "",
        session: params.sessionId || "",
      },
    },
    endGoal: params.endGoal,
    parts: [],
  };

  await mkdir(pd, { recursive: true });
  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  return { path: fp, planDir: pd, version };
}

async function readDesignMeta(dir: string): Promise<DesignMeta> {
  try {
    const raw = await readFile(join(dir, "meta.json"), "utf-8");
    return JSON.parse(raw) as DesignMeta;
  } catch {
    return {};
  }
}

export async function listDesigns(dataDir: string, scope: DesignsScope = "global", workspaceRoot?: string, sessionId?: string): Promise<DesignEntry[]> {
  const dir = resolveDesignsDir(dataDir, scope, workspaceRoot, sessionId);
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const results: DesignEntry[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;

    const pd = join(dir, e.name);
    const specs = await readVersions<SpecDocument>(pd, SPEC_RE);
    const plans = await readVersions<PlanDocument>(pd, PLAN_RE);
    const meta = await readDesignMeta(pd);

    const allFiles = await readdir(pd);
    const files = allFiles.filter((f) => f !== "meta.json" && !SPEC_RE.test(f) && !PLAN_RE.test(f));

    results.push({ name: e.name, path: pd, specs, plans, files, meta });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function registerPlansRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/plans", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string; sessionId?: string };
    const scope = (q.scope as DesignsScope) || "global";
    return listDesigns(dataDir, scope, q.workspaceRoot, q.sessionId);
  });

  app.post<{ Body: { name: string; goal?: string; endGoal?: string; scope?: string; workspaceRoot?: string; sessionId?: string } }>(
    "/api/plans/create-spec",
    async (request, reply) => {
      const { name, goal, endGoal, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }
      const sc = (scope as DesignsScope) || "global";
      if (sc === "project" && !workspaceRoot?.trim()) {
        return reply.code(400).send({ error: "workspaceRoot is required for project scope" });
      }
      if (sc === "session" && !sessionId?.trim()) {
        return reply.code(400).send({ error: "sessionId is required for session scope" });
      }
      const result = await createSpecDocument({
        name: name.trim(),
        // Frontend historically sent endGoal; accept both.
        goal: (goal ?? endGoal) || "",
        dataDir,
        scope: sc,
        workspaceRoot,
        sessionId,
        createdBy: "user",
      });
      return { ok: true, ...result };
    }
  );

  app.post<{ Body: { name: string; reason: string; successor?: string; scope?: string; workspaceRoot?: string; sessionId?: string } }>(
    "/api/plans/abandon",
    async (request, reply) => {
      const { name, reason, successor, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim() || !reason?.trim()) {
        return reply.code(400).send({ error: "name and reason are required" });
      }
      const sc = (scope as DesignsScope) || "global";
      const designsDir = resolveDesignsDir(dataDir, sc, workspaceRoot, sessionId);
      if (!designsDir) {
        return reply.code(400).send({
          error:
            sc === "project"
              ? "workspaceRoot is required for project scope"
              : "sessionId is required for session scope",
        });
      }
      const pd = join(designsDir, name);
      if (!existsSync(pd)) {
        return reply.code(404).send({ error: "design not found" });
      }
      const existing: DesignMeta = await readDesignMeta(pd);
      existing.abandoned = { reason, successor: successor?.trim() || undefined, timestamp: new Date().toISOString() };
      await writeFile(join(pd, "meta.json"), JSON.stringify(existing, null, 2) + "\n");
      return { ok: true };
    }
  );

  app.post<{ Body: { name: string; endGoal?: string; goal?: string; specReference?: string; scope?: string; workspaceRoot?: string; sessionId?: string } }>(
    "/api/plans/create-plan",
    async (request, reply) => {
      const { name, endGoal, goal, specReference, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }
      const sc = (scope as DesignsScope) || "global";
      if (sc === "project" && !workspaceRoot?.trim()) {
        return reply.code(400).send({ error: "workspaceRoot is required for project scope" });
      }
      if (sc === "session" && !sessionId?.trim()) {
        return reply.code(400).send({ error: "sessionId is required for session scope" });
      }
      const result = await createPlanDocument({
        name: name.trim(),
        endGoal: (endGoal ?? goal) || "",
        dataDir,
        scope: sc,
        workspaceRoot,
        sessionId,
        createdBy: "user",
        specReference,
      });
      return { ok: true, ...result };
    }
  );

  app.post<{ Body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string } }>(
    "/api/plans/delete",
    async (request, reply) => {
      const { name, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }
      const sc = (scope as DesignsScope) || "global";
      const designsDir = resolveDesignsDir(dataDir, sc, workspaceRoot, sessionId);
      if (!designsDir) {
        return reply.code(400).send({
          error:
            sc === "project"
              ? "workspaceRoot is required for project scope"
              : "sessionId is required for session scope",
        });
      }
      const pd = join(designsDir, name);
      if (!existsSync(pd)) {
        return reply.code(404).send({ error: "design not found" });
      }
      await rm(pd, { recursive: true, force: true });
      return { ok: true };
    }
  );

  app.post<{ Body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string } }>(
    "/api/plans/archive",
    async (request, reply) => {
      const { name, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }
      const sc = (scope as DesignsScope) || "global";
      const designsDir = resolveDesignsDir(dataDir, sc, workspaceRoot, sessionId);
      if (!designsDir) {
        return reply.code(400).send({
          error:
            sc === "project"
              ? "workspaceRoot is required for project scope"
              : "sessionId is required for session scope",
        });
      }
      const pd = join(designsDir, name);
      if (!existsSync(pd)) {
        return reply.code(404).send({ error: "design not found" });
      }
      const archivedBase = join(designsDir, `${name}.archived`);
      if (existsSync(archivedBase)) {
        await rm(archivedBase, { recursive: true, force: true });
      }
      await rename(pd, archivedBase);
      return { ok: true };
    }
  );
}
