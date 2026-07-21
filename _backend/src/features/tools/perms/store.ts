/**
 * Permission store — session layer is SQLite; workspace/global remain files.
 *
 * Layers (highest → lowest):
 *   1. session:    sessions.session_perms_json in visual-studio-harness.db
 *   2. workspace:  {workspaceRoot}/.visual-studio-harness/workspacePerms.json
 *   3. global:     {dataDir}/globalPerms.json
 *
 * If global is missing: WRITE it from hardcoded defaults (defaults.ts), then
 * READ the file back. Defaults are never used as the live permission source.
 */
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, normalize } from "node:path";
import type { PermissionMode, PermsFile, PermsLayer } from "../../../../../_shared/types";
import { atomicWriteFile } from "../host/atomic-write";
import { buildDefaultGlobalFile } from "./defaults";
import {
  getSessionPermsJson,
  setSessionPermsJson,
} from "../../../features/sessions/db";

const EMPTY: PermsFile = { version: 1, tools: {} };

function globalPath(dataDir: string): string {
  return join(resolve(dataDir), "globalPerms.json");
}

function workspacePath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".visual-studio-harness", "workspacePerms.json");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parsePerms(raw: string): PermsFile {
  try {
    const data = JSON.parse(raw) as Partial<PermsFile>;
    return normalizePerms(data);
  } catch {
    return { ...EMPTY, tools: {} };
  }
}

function normalizePerms(data: Partial<PermsFile> | Record<string, unknown>): PermsFile {
  const tools: Record<string, PermissionMode> = {};
  const rawTools =
    data && typeof data === "object" && "tools" in data && data.tools && typeof data.tools === "object"
      ? (data.tools as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(rawTools)) {
    if (v === "allow" || v === "ask" || v === "deny") tools[k] = v;
  }
  return {
    version:
      data && typeof data === "object" && "version" in data && typeof data.version === "number"
        ? data.version
        : 1,
    tools,
  };
}

/** Read + parse a perms JSON file. Returns null if missing / unreadable. */
async function readPermsFile(path: string): Promise<PermsFile | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return parsePerms(raw);
  } catch {
    return null;
  }
}

async function writePermsFile(path: string, file: PermsFile): Promise<void> {
  const body = JSON.stringify({ version: file.version ?? 1, tools: file.tools ?? {} }, null, 2) + "\n";
  await atomicWriteFile(path, body);
}

/**
 * Ensure {dataDir}/globalPerms.json exists, then always return what is ON DISK.
 * Missing → generate from hardcoded defaults → write file → read file back.
 */
export async function ensureGlobal(dataDir: string): Promise<PermsFile> {
  const path = globalPath(dataDir);

  if (await fileExists(path)) {
    const existing = await readPermsFile(path);
    if (existing) return existing;
    // Corrupt / unreadable: fall through and rewrite from defaults
  }

  // WRITE only — defaults are not the live config
  await writePermsFile(path, buildDefaultGlobalFile());

  const fromDisk = await readPermsFile(path);
  if (!fromDisk) {
    throw new Error(`Wrote global perms but failed to read: ${path}`);
  }
  return fromDisk;
}

/**
 * Overwrite global by regenerating from hardcoded defaults, then read from disk.
 */
export async function resetGlobal(dataDir: string): Promise<PermsFile> {
  const path = globalPath(dataDir);
  await writePermsFile(path, buildDefaultGlobalFile());
  const fromDisk = await readPermsFile(path);
  if (!fromDisk) {
    throw new Error(`Reset global but failed to read: ${path}`);
  }
  return fromDisk;
}

/** Shape used when listing known tools / seeding UI — from disk after ensure. */
export async function loadTemplate(dataDir: string): Promise<PermsFile> {
  return ensureGlobal(dataDir);
}

export async function readGlobal(dataDir: string): Promise<{ path: string; exists: boolean; file: PermsFile }> {
  const path = globalPath(dataDir);
  const existed = await fileExists(path);
  const file = await ensureGlobal(dataDir);
  return { path, exists: existed, file };
}

export async function writeGlobal(dataDir: string, tools: Record<string, PermissionMode>, version = 1): Promise<PermsFile> {
  const path = globalPath(dataDir);
  await writePermsFile(path, { version, tools: { ...tools } });
  const fromDisk = await readPermsFile(path);
  if (!fromDisk) throw new Error(`Wrote global perms but failed to read: ${path}`);
  return fromDisk;
}

export async function readWorkspace(
  workspaceRoot: string
): Promise<{ path: string; exists: boolean; file: PermsFile }> {
  const root = resolve(workspaceRoot);
  const path = workspacePath(root);
  const existing = await readPermsFile(path);
  return {
    path,
    exists: existing !== null,
    file: existing ?? { version: 1, tools: {} },
  };
}

export async function writeWorkspace(
  workspaceRoot: string,
  tools: Record<string, PermissionMode>,
  version = 1
): Promise<PermsFile> {
  const root = resolve(workspaceRoot);
  const path = workspacePath(root);
  const normalized = normalize(path);
  if (!normalized.startsWith(root)) {
    throw new Error("workspace perms path escapes workspace root");
  }
  await writePermsFile(path, { version, tools: { ...tools } });
  const fromDisk = await readPermsFile(path);
  if (!fromDisk) throw new Error(`Wrote workspace perms but failed to read: ${path}`);
  return fromDisk;
}

export async function readSession(
  dataDir: string,
  sessionId: string
): Promise<{ path: string; exists: boolean; file: PermsFile }> {
  // SQLite only — no session folder / sessionPerms.json
  const raw = getSessionPermsJson(sessionId, dataDir);
  if (raw) {
    return {
      path: `sqlite:sessions/${sessionId}/session_perms_json`,
      exists: true,
      file: parsePerms(raw),
    };
  }
  return {
    path: `sqlite:sessions/${sessionId}/session_perms_json`,
    exists: false,
    file: { version: 1, tools: {} },
  };
}

export async function writeSession(
  dataDir: string,
  sessionId: string,
  tools: Record<string, PermissionMode>,
  version = 1
): Promise<PermsFile> {
  const file: PermsFile = { version, tools: { ...tools } };
  setSessionPermsJson(sessionId, JSON.stringify(file), dataDir);
  return file;
}

/** Set a single tool mode on a layer (merge for session/workspace; update key for global). */
export async function setToolMode(opts: {
  layer: PermsLayer;
  dataDir: string;
  sessionId?: string;
  workspaceRoot?: string;
  toolName: string;
  mode: PermissionMode;
}): Promise<void> {
  const { layer, dataDir, sessionId, workspaceRoot, toolName, mode } = opts;
  if (layer === "global") {
    const { file } = await readGlobal(dataDir);
    file.tools[toolName] = mode;
    await writeGlobal(dataDir, file.tools, file.version);
    return;
  }
  if (layer === "workspace") {
    if (!workspaceRoot?.trim()) throw new Error("workspaceRoot required for workspace perms");
    const { file } = await readWorkspace(workspaceRoot);
    file.tools[toolName] = mode;
    await writeWorkspace(workspaceRoot, file.tools, file.version);
    return;
  }
  if (layer === "session") {
    if (!sessionId?.trim()) throw new Error("sessionId required for session perms");
    const { file } = await readSession(dataDir, sessionId);
    file.tools[toolName] = mode;
    await writeSession(dataDir, sessionId, file.tools, file.version);
    return;
  }
  throw new Error(`unknown layer: ${layer}`);
}

export const paths = {
  global: globalPath,
  /** Session perms live in SQLite; path is a logical key for logs/UI. */
  session: (dataDir: string, sessionId: string) =>
    `sqlite:${dataDir}/visual-studio-harness.db#sessions/${sessionId}/session_perms_json`,
  workspace: workspacePath,
};
