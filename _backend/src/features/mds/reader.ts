import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentSettings, SkillMdConfig } from "../../../_shared/types";

async function fileExists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

/**
 * Lists AGENTS.md files directly in rootDir (non-recursive).
 * These are project-level rules files, NOT system prompt base or agent definitions.
 * Prefers lowercase `agents.md` over uppercase `AGENTS.md` when both exist.
 */
export async function listAgentsMdAtRoot(rootDir: string): Promise<string[]> {
  const root = resolve(rootDir);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const found = new Set<string>();
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (lower === "agents.md") found.add(join(root, e.name));
  }
  const paths = [...found];
  const hasLower = paths.some((p) => p.endsWith("/agents.md"));
  return hasLower ? paths.filter((p) => p.endsWith("/agents.md")).sort() : paths.sort();
}

/** Lists agents.md files from `{workspaceRoot}/.agentHarness/mds/` (scoped project MDs). */
export async function listAgentsMdAtScopedRoot(rootDir: string): Promise<string[]> {
  const scopedDir = join(resolve(rootDir), ".agentHarness", "mds");
  return listAgentsMdAtRoot(scopedDir);
}

export async function readAgentsFile(path: string): Promise<string | null> {
  if (!(await fileExists(path))) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const trimmed = raw.trim();
    return trimmed || null;
  } catch (err) {
    console.warn(`[system-prompt] unreadable agents file ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Reads and concatenates all AGENTS.md files found at the workspace root (project-level rules). */
export async function readProjectAgentsMd(rootDir: string): Promise<string> {
  const parts: string[] = [];
  for (const path of await listAgentsMdAtRoot(rootDir)) {
    const text = await readAgentsFile(path);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

/**
 * Read an MDS prompt: if `path` is a directory (item folder), read prompt.md inside;
 * if it's a file (prompt.md or legacy .md), read it directly.
 */
async function readPromptPath(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    const target = info.isDirectory() ? join(path, "prompt.md") : path;
    const raw = await readFile(target, "utf-8");
    return raw.trim() || null;
  } catch (err) {
    console.warn(`[system-prompt] unreadable prompt ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function resolveAgentMd(agentMd: AgentSettings["agentMd"]): Promise<string | null> {
  if (!agentMd) return null;
  if (agentMd.mode === "inline") return agentMd.content?.trim() || null;
  if (!agentMd.path) return null;
  return readPromptPath(agentMd.path);
}

async function resolveSingleSkillMd(skill: SkillMdConfig): Promise<string | null> {
  if (skill.mode === "custom") {
    if (!skill.path) return null;
    return readPromptPath(skill.path);
  }
  return null;
}

export async function resolveSkillMds(skillMds: SkillMdConfig[] | undefined): Promise<string[]> {
  if (!skillMds?.length) return [];
  const results: string[] = [];
  for (const skill of skillMds) {
    const content = await resolveSingleSkillMd(skill);
    if (content) results.push(content);
  }
  return results;
}
