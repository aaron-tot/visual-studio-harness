import type { FastifyInstance } from "fastify";
import { join, resolve } from "node:path";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { moveScopedDir, MoveError } from "./scope-move";

export type NotesScope = "global" | "project" | "session";

export function resolveNotesDir(
  dataDir: string,
  scope: NotesScope | undefined,
  workspaceRoot?: string,
  sessionId?: string
): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return join(resolve(workspaceRoot), ".agentHarness", "notes");
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "notes");
    default:
      return join(dataDir, "notes");
  }
}

/** All possible notes directories for a given dataDir (used for fallback search). */
export function allPossibleNotesDirs(dataDir: string, sessionId?: string): string[] {
  const dirs = [join(dataDir, "notes")];
  if (sessionId) dirs.push(join(dataDir, "session", sessionId, "notes"));
  // legacy pre-session-hash fallback
  dirs.push(join(dataDir, "session", "notes"));
  return dirs;
}

/** Find a note directory by name, searching all possible notes directories. */
export async function findNoteDirByName(
  dataDir: string,
  name: string,
  sessionId?: string,
): Promise<string | null> {
  for (const dir of allPossibleNotesDirs(dataDir, sessionId)) {
    const nd = join(dir, name);
    if (existsSync(nd)) return nd;
  }
  return null;
}

/** Locate which scope holds a note by name (session → project → global). */
export async function findNoteScope(
  name: string,
  dataDir: string,
  workspaceRoot?: string,
  sessionId?: string,
): Promise<NotesScope | null> {
  const candidates: NotesScope[] = [];
  if (sessionId) candidates.push("session");
  if (workspaceRoot) candidates.push("project");
  candidates.push("global");
  for (const scope of candidates) {
    const dir = resolveNotesDir(dataDir, scope, workspaceRoot, sessionId);
    if (dir && existsSync(join(dir, name))) return scope;
  }
  return null;
}

export interface NoteMeta {
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export interface NoteEntry {
  name: string;
  path: string;
  title: string;
  body: string;
  meta: NoteMeta;
}

async function readNoteMeta(dir: string): Promise<NoteMeta | null> {
  try {
    const raw = await readFile(join(dir, "note.json"), "utf-8");
    const data = JSON.parse(raw);
    return data.meta as NoteMeta;
  } catch {
    return null;
  }
}

async function readNoteContent(dir: string): Promise<{ title: string; body: string } | null> {
  try {
    const raw = await readFile(join(dir, "note.json"), "utf-8");
    const data = JSON.parse(raw);
    return { title: typeof data.title === "string" ? data.title : "", body: typeof data.body === "string" ? data.body : "" };
  } catch {
    return null;
  }
}

export async function listNotes(
  dataDir: string,
  scope: NotesScope = "global",
  workspaceRoot?: string,
  sessionId?: string
): Promise<NoteEntry[]> {
  // Search all possible notes directories
  const allDirs = allPossibleNotesDirs(dataDir, sessionId);
  const results: NoteEntry[] = [];

  for (const dir of allDirs) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const pd = join(dir, e.name);
      const meta = await readNoteMeta(pd);
      const content = await readNoteContent(pd);
      if (!meta || !content) continue;
      results.push({
        name: e.name,
        path: pd,
        title: content.title,
        body: content.body,
        meta,
      });
    }
  }

  return results.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
}

export interface CreateNoteParams {
  name: string;
  title: string;
  body: string;
  dataDir: string;
  scope?: NotesScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function createNote(params: CreateNoteParams): Promise<{ path: string }> {
  const scope = params.scope || "global";
  const notesDir = resolveNotesDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!notesDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project notes"
        : scope === "session"
          ? "sessionId is required for session notes"
          : "invalid notes scope"
    );
  }

  const nd = join(notesDir, params.name);
  const now = new Date().toISOString();
  const doc = {
    title: params.title,
    body: params.body,
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  };

  await mkdir(nd, { recursive: true });
  await writeFile(join(nd, "note.json"), JSON.stringify(doc, null, 2) + "\n");
  return { path: nd };
}

export interface UpdateNoteParams {
  name: string;
  title?: string;
  body?: string;
  dataDir: string;
  scope?: NotesScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function updateNote(params: UpdateNoteParams): Promise<{ path: string }> {
  const scope = params.scope || "global";
  const notesDir = resolveNotesDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!notesDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project notes"
        : scope === "session"
          ? "sessionId is required for session notes"
          : "invalid notes scope"
    );
  }

  let nd = join(notesDir, params.name);
  let fp = join(nd, "note.json");
  if (!existsSync(fp)) {
    // Fallback: search all possible notes directories
    const foundDir = await findNoteDirByName(params.dataDir, params.name, params.sessionId);
    if (!foundDir) {
      throw new Error("note not found");
    }
    nd = foundDir;
    fp = join(nd, "note.json");
  }

  const raw = await readFile(fp, "utf-8");
  const doc = JSON.parse(raw);

  if (params.title !== undefined) doc.title = params.title;
  if (params.body !== undefined) doc.body = params.body;
  doc.meta.updatedAt = new Date().toISOString();

  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  return { path: nd };
}

export interface ArchiveNoteParams {
  name: string;
  dataDir: string;
  scope?: NotesScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function archiveNote(params: ArchiveNoteParams): Promise<{ archivedPath: string }> {
  const scope = params.scope || "global";
  const notesDir = resolveNotesDir(params.dataDir, scope, params.workspaceRoot, params.sessionId);
  if (!notesDir) {
    throw new Error(
      scope === "project"
        ? "workspaceRoot is required for project notes"
        : scope === "session"
          ? "sessionId is required for session notes"
          : "invalid notes scope"
    );
  }
  let nd = join(notesDir, params.name);
  if (!existsSync(nd)) {
    const foundDir = await findNoteDirByName(params.dataDir, params.name, params.sessionId);
    if (!foundDir) {
      throw new Error("note not found");
    }
    nd = foundDir;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/T/, "_").slice(0, 19);
  const archivedPath = join(notesDir, `${params.name}.archived.${ts}`);
  await rename(nd, archivedPath);
  return { archivedPath };
}

export interface MoveNoteParams {
  name: string;
  fromScope: NotesScope;
  toScope: NotesScope;
  dataDir: string;
  workspaceRoot?: string;
  sessionId?: string;
}

export async function moveNote(
  params: MoveNoteParams,
): Promise<{ fromPath: string; toPath: string }> {
  const fromDir = resolveNotesDir(params.dataDir, params.fromScope, params.workspaceRoot, params.sessionId);
  const toDir = resolveNotesDir(params.dataDir, params.toScope, params.workspaceRoot, params.sessionId);
  if (!fromDir) throw new MoveError(`source scope "${params.fromScope}" not available`, 400);
  if (!toDir) throw new MoveError(`target scope "${params.toScope}" not available`, 400);
  const r = await moveScopedDir({ name: params.name, fromDir, toDir });
  const fp = join(r.toPath, "note.json");
  try {
    const doc = JSON.parse(await readFile(fp, "utf-8")) as { meta?: { updatedAt?: string } };
    if (doc.meta) doc.meta.updatedAt = new Date().toISOString();
    await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");
  } catch {
    // missing/unparseable note.json — leave as-is
  }
  return r;
}

export function registerNotesRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/notes", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string; sessionId?: string };
    const scope = (q.scope as NotesScope) || "global";
    return listNotes(dataDir, scope, q.workspaceRoot, q.sessionId);
  });

  app.post<{
    Body: { name: string; title: string; body: string; scope?: string; workspaceRoot?: string; sessionId?: string };
  }>("/api/notes/create", async (request, reply) => {
    const { name, title, body, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const sc = (scope as NotesScope) || "global";
    if (sc === "project" && !workspaceRoot?.trim()) {
      return reply.code(400).send({ error: "workspaceRoot is required for project scope" });
    }
    if (sc === "session" && !sessionId?.trim()) {
      return reply.code(400).send({ error: "sessionId is required for session scope" });
    }
    const result = await createNote({
      name: name.trim(),
      title: title?.trim() || "",
      body: body?.trim() || "",
      dataDir,
      scope: sc,
      workspaceRoot,
      sessionId,
    });
    return { ok: true, ...result };
  });

  app.put<{
    Body: { name: string; title?: string; body?: string; scope?: string; workspaceRoot?: string; sessionId?: string };
  }>("/api/notes/update", async (request, reply) => {
    const { name, title, body, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const sc = (scope as NotesScope) || "global";
    if (sc === "project" && !workspaceRoot?.trim()) {
      return reply.code(400).send({ error: "workspaceRoot is required for project scope" });
    }
    if (sc === "session" && !sessionId?.trim()) {
      return reply.code(400).send({ error: "sessionId is required for session scope" });
    }
    const result = await updateNote({
      name: name.trim(),
      title: title?.trim(),
      body,
      dataDir,
      scope: sc,
      workspaceRoot,
      sessionId,
    });
    return { ok: true, ...result };
  });

  app.post<{
    Body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string };
  }>("/api/notes/archive", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    try {
      const result = await archiveNote({
        name: name.trim(),
        dataDir,
        scope: (scope as NotesScope) || "global",
        workspaceRoot,
        sessionId,
      });
      return { ok: true, ...result };
    } catch (e: any) {
      if (e.message === "note not found") {
        return reply.code(404).send({ error: "note not found" });
      }
      throw e;
    }
  });

  app.post<{
    Body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string };
  }>("/api/notes/delete", async (request, reply) => {
    const { name, scope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) {
      return reply.code(400).send({ error: "name is required" });
    }
    const sc = (scope as NotesScope) || "global";
    const notesDir = resolveNotesDir(dataDir, sc, workspaceRoot, sessionId);
    if (!notesDir) {
      return reply.code(400).send({
        error:
          sc === "project"
            ? "workspaceRoot is required for project scope"
            : "sessionId is required for session scope",
      });
    }
    const nd = join(notesDir, name);
    if (!existsSync(nd)) {
      return reply.code(404).send({ error: "note not found" });
    }
    await rm(nd, { recursive: true, force: true });
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
  }>("/api/notes/move", async (request, reply) => {
    const { name, fromScope, toScope, workspaceRoot, sessionId } = request.body;
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    const fs_ = (fromScope as NotesScope) || "global";
    const ts = (toScope as NotesScope) || "global";
    if (!["global", "project", "session"].includes(fs_) || !["global", "project", "session"].includes(ts)) {
      return reply.code(400).send({ error: "invalid scope" });
    }
    if (fs_ === ts) return reply.code(400).send({ error: "from and to scopes are the same" });
    try {
      const result = await moveNote({ name: name.trim(), fromScope: fs_, toScope: ts, dataDir, workspaceRoot, sessionId });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof MoveError) return reply.code(err.code).send({ error: err.message });
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
