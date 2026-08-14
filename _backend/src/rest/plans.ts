import type { FastifyInstance } from "fastify";
import { join, resolve } from "node:path";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SpecDocument, PlanDocument, SpecPlanPart, CreatedBy } from "../../../_shared/types";
import { moveScopedDir, MoveError } from "./scope-move";

/** Recursively ensure every SpecPlanPart has a `parts` array. */
function ensurePartsArray(p: SpecPlanPart): SpecPlanPart {
  if (!Array.isArray(p.parts)) p.parts = [];
  for (const child of p.parts) ensurePartsArray(child);
  return p;
}

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

async function readVersions<T extends { meta?: { version?: number } }>(dir: string, pattern: RegExp): Promise<T[]> {
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
        // Guarantee meta.version from filename so list tools never crash on
        // older/malformed docs that omitted meta or meta.version.
        if (!doc.meta || typeof doc.meta !== "object") {
          (doc as { meta: { version: number } }).meta = { version };
        } else if (doc.meta.version == null) {
          doc.meta.version = version;
        }
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
  /** Optional full/partial document body. Fields here override the default empty template. */
  content?: Record<string, unknown>;
}

/** Documented `content` keys for a spec. `meta` is documented but ignored. */
const SPEC_KNOWN_KEYS = new Set(["goal", "requirements", "constraints", "assumptions", "acceptanceCriteria", "parts", "meta"]);
/** Documented `content` keys for a plan. `meta` is documented but ignored. */
const PLAN_KNOWN_KEYS = new Set(["endGoal", "mainSpec", "tags", "parts", "meta"]);

/** Split content into known fields (handled elsewhere) vs non-standard keys to preserve. */
function splitContent(c: Record<string, unknown>, known: Set<string>): { custom: Record<string, unknown>; customKeys: string[] } {
  const custom: Record<string, unknown> = {};
  const customKeys: string[] = [];
  for (const k of Object.keys(c)) {
    if (!known.has(k)) {
      custom[k] = c[k];
      customKeys.push(k);
    }
  }
  return { custom, customKeys };
}

export async function createSpecDocument(params: CreateSpecParams): Promise<{ path: string; planDir: string; version: number; customKeys: string[] }> {
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
  const c = params.content || {};
  // Allow content.goal or top-level goal; top-level wins
  const goal = params.goal || (typeof c.goal === "string" ? c.goal : "");
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
    goal,
    requirements: Array.isArray(c.requirements) ? (c.requirements as string[]) : [],
    constraints: Array.isArray(c.constraints) ? (c.constraints as string[]) : [],
    assumptions: Array.isArray(c.assumptions) ? (c.assumptions as string[]) : [],
    acceptanceCriteria: Array.isArray(c.acceptanceCriteria) ? (c.acceptanceCriteria as string[]) : [],
    parts: Array.isArray(c.parts) ? (c.parts as SpecPlanPart[]).map(ensurePartsArray) : [],
  };
  const { custom, customKeys } = splitContent(c, SPEC_KNOWN_KEYS);
  if (customKeys.length) doc.customContent = custom;

  await mkdir(pd, { recursive: true });
  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  return { path: fp, planDir: pd, version, customKeys };
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
  /** Optional full/partial document body. Fields here override the default empty template. */
  content?: Record<string, unknown>;
}

export async function createPlanDocument(params: CreatePlanParams): Promise<{ path: string; planDir: string; version: number; customKeys: string[] }> {
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
  const c = params.content || {};
  // Allow content.endGoal or top-level endGoal; top-level wins
  const endGoal = params.endGoal || (typeof c.endGoal === "string" ? c.endGoal : "");
  const doc: PlanDocument = {
    meta: {
      id: params.name,
      version,
      mainSpec: params.specReference || (typeof c.mainSpec === "string" ? c.mainSpec : ""),
      relatedSpecs: [],
      title: params.name,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      createdBy: params.createdBy,
      status: "draft",
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      createdMeta: {
        datetime: now,
        workspace: params.workspaceRoot || "",
        session: params.sessionId || "",
      },
    },
    endGoal,
    parts: Array.isArray(c.parts) ? (c.parts as SpecPlanPart[]).map(ensurePartsArray) : [],
  };
  const { custom, customKeys } = splitContent(c, PLAN_KNOWN_KEYS);
  if (customKeys.length) doc.customContent = custom;

  await mkdir(pd, { recursive: true });
  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  return { path: fp, planDir: pd, version, customKeys };
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
  if (!dir || !existsSync(dir)) return [];

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

/** Batch list designs for multiple workspace roots (project scope) or session IDs (session scope).
 *  Returns a map keyed by workspaceRoot/sessionId to DesignEntry[]. */
export async function listDesignsBatch(
  dataDir: string,
  scope: DesignsScope,
  workspaceRoots?: string[],
  sessionIds?: string[]
): Promise<Map<string, DesignEntry[]>> {
  const results = new Map<string, DesignEntry[]>();

  if (scope === "project" && workspaceRoots?.length) {
    await Promise.all(
      workspaceRoots.map(async (root) => {
        const designs = await listDesigns(dataDir, "project", root);
        results.set(root, designs);
      })
    );
    return results;
  }

  if (scope === "session" && sessionIds?.length) {
    await Promise.all(
      sessionIds.map(async (sid) => {
        const designs = await listDesigns(dataDir, "session", undefined, sid);
        results.set(sid, designs);
      })
    );
    return results;
  }

  // Global scope - just return single entry
  const designs = await listDesigns(dataDir, "global");
  results.set("global", designs);
  return results;
}

/** Locate which scope holds a design by name (session → project → global). */
export async function findDesignScope(
  name: string,
  dataDir: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<DesignsScope | null> {
  const candidates: DesignsScope[] = [];
  if (sessionId) candidates.push("session");
  if (workspaceRoot) candidates.push("project");
  candidates.push("global");
  for (const scope of candidates) {
    const dir = resolveDesignsDir(dataDir, scope, workspaceRoot, sessionId);
    if (dir && existsSync(join(dir, name))) return scope;
  }
  return null;
}

export interface MoveDesignParams {
  name: string;
  fromScope: DesignsScope;
  toScope: DesignsScope;
  dataDir: string;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function moveDesign(
  params: MoveDesignParams,
): Promise<{ fromPath: string; toPath: string }> {
  const fromDir = resolveDesignsDir(params.dataDir, params.fromScope, params.workspaceRoot, params.sessionId);
  const toDir = resolveDesignsDir(params.dataDir, params.toScope, params.workspaceRoot, params.sessionId);
  if (!fromDir) throw new MoveError(`source scope "${params.fromScope}" not available`, 400);
  if (!toDir) throw new MoveError(`target scope "${params.toScope}" not available`, 400);
  const r = await moveScopedDir({ name: params.name, fromDir, toDir });
  const files = (await readdir(r.toPath)).filter((f) => SPEC_RE.test(f) || PLAN_RE.test(f));
  for (const f of files) {
    const fp = join(r.toPath, f);
    try {
      const doc = JSON.parse(await readFile(fp, "utf-8")) as {
        meta?: { updatedAt?: string; createdMeta?: { workspace?: string; session?: string } };
      };
      if (doc.meta) {
        doc.meta.updatedAt = new Date().toISOString();
        if (!doc.meta.createdMeta) doc.meta.createdMeta = {};
        doc.meta.createdMeta.workspace = params.toScope === "project" ? params.workspaceRoot || "" : "";
        doc.meta.createdMeta.session = params.toScope === "session" ? params.sessionId || "" : "";
      }
      await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
    } catch {
      // skip unparseable version files
    }
  }
  return r;
}

export function registerPlansRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/plans", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string; sessionId?: string };
    const scope = (q.scope as DesignsScope) || "global";
    return listDesigns(dataDir, scope, q.workspaceRoot, q.sessionId);
  });

  app.post<{
    Body: { scope?: string; workspaceRoots?: string[]; sessionIds?: string[] };
  }>("/api/plans/batch", async (request, reply) => {
    const { scope, workspaceRoots, sessionIds } = request.body;
    const sc = (scope as DesignsScope) || "global";
    if (sc === "project" && (!workspaceRoots?.length)) {
      return reply.code(400).send({ error: "workspaceRoots required for project scope" });
    }
    if (sc === "session" && (!sessionIds?.length)) {
      return reply.code(400).send({ error: "sessionIds required for session scope" });
    }
    const results = await listDesignsBatch(dataDir, sc, workspaceRoots, sessionIds);
    // Convert Map to object for JSON serialization
    const obj: Record<string, DesignEntry[]> = {};
    for (const [key, value] of results) obj[key] = value;
    return obj;
  });

  app.post<{ Body: { name: string; goal?: string; endGoal?: string; scope?: string; workspaceRoot?: string; sessionId?: string; createdBy?: string; content?: Record<string, unknown> } }>(
    "/api/plans/create-spec",
    async (request, reply) => {
      const { name, goal, endGoal, scope, workspaceRoot, sessionId, createdBy, content } = request.body;
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
        createdBy: (createdBy === "agent" ? "agent" : "user") as CreatedBy,
        content,
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

  app.post<{ Body: { name: string; endGoal?: string; goal?: string; specReference?: string; scope?: string; workspaceRoot?: string; sessionId?: string; createdBy?: string; content?: Record<string, unknown> } }>(
    "/api/plans/create-plan",
    async (request, reply) => {
      const { name, endGoal, goal, specReference, scope, workspaceRoot, sessionId, createdBy, content } = request.body;
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
        createdBy: (createdBy === "agent" ? "agent" : "user") as CreatedBy,
        specReference,
        content,
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
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);
      const archivedPath = join(designsDir, `${name}.archived.${ts}`);
      await rename(pd, archivedPath);
      return { ok: true, archivedPath };
    }
  );

  app.post<{
    Body: {
      name: string;
      docType: "spec" | "plan";
      version: number;
      fields: Record<string, unknown>;
      scope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>(
    "/api/plans/update-doc",
    async (request, reply) => {
      const { name, docType, version, fields, scope, workspaceRoot, sessionId } = request.body;
      if (!name?.trim() || !docType || !version || !fields) {
        return reply.code(400).send({ error: "name, docType, version, and fields are required" });
      }
      const sc = (scope as DesignsScope) || "global";
      const designsDir = resolveDesignsDir(dataDir, sc, workspaceRoot, sessionId);
      if (!designsDir) {
        return reply.code(400).send({
          error: sc === "project"
            ? "workspaceRoot is required for project scope"
            : "sessionId is required for session scope",
        });
      }
      const pd = join(designsDir, name);
      const filename = docType === "spec" ? `specV${version}.json` : `planV${version}.json`;
      const fp = join(pd, filename);
      if (!existsSync(fp)) {
        return reply.code(404).send({ error: `${docType} v${version} not found` });
      }
      const raw = await readFile(fp, "utf-8");
      const doc = JSON.parse(raw);
      doc.meta.updatedAt = new Date().toISOString();
      doc.meta.updatedBy = "user";
      // Merge allowed fields into the document root (not meta)
      for (const [key, value] of Object.entries(fields)) {
        if (key === "meta") continue; // never overwrite meta via partial update
        doc[key] = value;
      }
      await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
      return { ok: true, path: fp, version };
    }
  );

  app.post<{
    Body: {
      name: string;
      fromScope?: string;
      toScope?: string;
      workspaceRoot?: string;
      sessionId?: string;
    };
  }>("/api/plans/move", async (request, reply) => {
    const { name, fromScope, toScope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    const fs_ = (fromScope as DesignsScope) || "global";
    const ts = (toScope as DesignsScope) || "global";
    if (!["global", "project", "session"].includes(fs_) || !["global", "project", "session"].includes(ts)) {
      return reply.code(400).send({ error: "invalid scope" });
    }
    if (fs_ === ts) return reply.code(400).send({ error: "from and to scopes are the same" });
    try {
      const result = await moveDesign({ name: name.trim(), fromScope: fs_, toScope: ts, dataDir, workspaceRoot, sessionId });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof MoveError) return reply.code(err.code).send({ error: err.message });
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
