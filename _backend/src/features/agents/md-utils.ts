import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentSettings, SkillMdConfig } from "../../../_shared/types";
import { AGENTS_MD_NAMES } from "./constants";

async function fileExists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

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

export async function readAgentsFromRoot(rootDir: string): Promise<string> {
  const parts: string[] = [];
  for (const path of await listAgentsMdAtRoot(rootDir)) {
    const text = await readAgentsFile(path);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

export async function resolveAgentMd(agentMd: AgentSettings["agentMd"]): Promise<string | null> {
  if (!agentMd) return null;
  if (agentMd.mode === "inline") return agentMd.content?.trim() || null;
  if (!agentMd.path) return null;
  try {
    const raw = await readFile(agentMd.path, "utf-8");
    return raw.trim() || null;
  } catch (err) {
    console.warn(`[system-prompt] unreadable agent MD ${agentMd.path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function resolveSingleSkillMd(skill: SkillMdConfig): Promise<string | null> {
  if (skill.mode === "custom") {
    if (!skill.path) return null;
    try {
      const raw = await readFile(skill.path, "utf-8");
      return raw.trim() || null;
    } catch (err) {
      console.warn(`[system-prompt] unreadable skill MD ${skill.path}:`, err instanceof Error ? err.message : err);
      return null;
    }
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
