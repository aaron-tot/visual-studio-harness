import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import type { SkillMdConfig, AgentMdConfig } from "../../../../_shared/types";
import { resolveMdsScopeDir } from "./paths";

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
 * Read an MDS prompt: if `path` is a directory (item folder), read prompt.md inside
 * (or `<dirname>.skill.md` for legacy tool-skill folders, or `skill.md` for
 * unified tool-folder guides at data/tools/{builtin,custom}/<name>/); if it's a
 * file, read it directly.
 */
async function readPromptPath(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    let target: string;
    if (info.isDirectory()) {
      const name = basename(path);
      target = existsSync(join(path, "prompt.md"))
        ? join(path, "prompt.md")
        : existsSync(join(path, `${name}.skill.md`))
          ? join(path, `${name}.skill.md`)
          : join(path, "skill.md");
    } else {
      target = path;
    }
    const raw = await readFile(target, "utf-8");
    return raw.trim() || null;
  } catch (err) {
    console.warn(`[system-prompt] unreadable prompt ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface ResolveContext {
  dataDir: string;
  workspaceRoot?: string;
  sessionId?: string;
}

/**
 * Collect all MDS items matching a tag across available scopes.
 * Scopes searched in order: session > project > global (most specific wins).
 */
async function resolveByTag(tag: string, scope: string | undefined, ctx?: ResolveContext): Promise<{ path: string; promptPath: string } | null> {
  if (!ctx) return null;
  const scopes: { name: string; dir: string | null }[] = [
    { name: "session", dir: ctx.sessionId ? resolveMdsScopeDir("session", ctx.dataDir, undefined, ctx.sessionId) : null },
    { name: "project", dir: ctx.workspaceRoot ? resolveMdsScopeDir("project", ctx.dataDir, ctx.workspaceRoot) : null },
    { name: "global", dir: resolveMdsScopeDir("global", ctx.dataDir) },
  ];

  // If a specific scope is requested, search only that one
  const searchScopes = scope ? scopes.filter((s) => s.name === scope) : scopes;

  for (const { dir } of searchScopes) {
    if (!dir || !existsSync(dir)) continue;
    try {
      const item = await findItemInScopeByTag(dir, tag);
      if (item) return item;
    } catch {
      // skip unreadable scope
    }
  }
  return null;
}

async function findItemInScopeByTag(scopeDir: string, tag: string): Promise<{ path: string; promptPath: string } | null> {
  const entries = await readdir(scopeDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = join(scopeDir, e.name);
    // An item folder has prompt.md, <dirname>.skill.md (legacy tool-skill), OR
    // skill.md (unified tool-folder guide at data/tools/{builtin,custom}/<name>/).
    const mdPath = join(full, "prompt.md");
    const toolMdPath = join(full, `${e.name}.skill.md`);
    const folderSkillMd = join(full, "skill.md");
    const jsonPath = join(full, "prompt.json");
    const toolJsonPath = join(full, `${e.name}.prompt.json`);
    const hasMd = existsSync(mdPath) || existsSync(toolMdPath) || existsSync(folderSkillMd);
    if (hasMd) {
      // Item folder — check tags (from prompt.json or <dirname>.prompt.json)
      const tagsJson = existsSync(jsonPath) ? jsonPath : toolJsonPath;
      try {
        const raw = await readFile(tagsJson, "utf-8");
        const parsed = JSON.parse(raw) as { tags?: unknown };
        const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === "string") : [];
        if (tags.includes(tag)) {
          const promptPath = existsSync(mdPath)
            ? mdPath
            : existsSync(toolMdPath)
              ? toolMdPath
              : folderSkillMd;
          return { path: full, promptPath };
        }
      } catch {
        // unreadable prompt.json — skip
      }
    } else {
      // Container folder — recurse
      const found = await findItemInScopeByTag(full, tag);
      if (found) return found;
    }
  }
  return null;
}

export async function resolveAgentMd(agentMd: AgentMdConfig | undefined, ctx?: ResolveContext): Promise<string | null> {
  if (!agentMd) return null;
  // Tag-based resolution (resilient to moves/renames)
  if (agentMd.tag) {
    const found = await resolveByTag(agentMd.tag, agentMd.scope, ctx);
    if (found) return readPromptPath(found.promptPath);
    // Tag not found — fall through to path-based as fallback
  }
  if (agentMd.mode === "inline") return agentMd.content?.trim() || null;
  if (!agentMd.path) return null;
  return readPromptPath(agentMd.path);
}

async function resolveSingleSkillMd(skill: SkillMdConfig, ctx?: ResolveContext): Promise<string | null> {
  // Tag-based resolution
  if (skill.tag) {
    const found = await resolveByTag(skill.tag, skill.scope, ctx);
    if (found) return readPromptPath(found.promptPath);
    // Tag not found — fall through
  }
  if (skill.mode === "custom") {
    if (!skill.path) return null;
    return readPromptPath(skill.path);
  }
  return null;
}

export async function resolveSkillMds(skillMds: SkillMdConfig[] | undefined, ctx?: ResolveContext): Promise<string[]> {
  if (!skillMds?.length) return [];
  const results: string[] = [];
  for (const skill of skillMds) {
    const content = await resolveSingleSkillMd(skill, ctx);
    if (content) results.push(content);
  }
  return results;
}
