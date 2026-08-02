import { join, extname } from "node:path";
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getSession } from "../../storage/session";
import { resolveDataDirInfo } from "../../paths";
import { seedsDir, seedSubdirForMode } from "./paths";

interface ScopeDirNode {
  name: string;
  type: "file" | "dir";
  ext: string;
  children: ScopeDirNode[];
  /** true when this dir is an MDS item folder (contains prompt.md) */
  isItem?: boolean;
}

/**
 * Collect unique tags across all prompt.json files under `dir` (recursive).
 */
export async function collectScopeTags(dir: string): Promise<string[]> {
  const tags = new Set<string>();
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name === "prompt.json") {
        try {
          const raw = await readFile(full, "utf-8");
          const parsed = JSON.parse(raw) as { tags?: unknown };
          if (Array.isArray(parsed.tags)) {
            for (const t of parsed.tags) {
              if (typeof t === "string" && t.trim()) tags.add(t.trim());
            }
          }
        } catch {
          // unreadable prompt.json — skip
        }
      }
    }
  }
  await walk(dir);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

interface ScopeItem {
  name: string;
  relPath: string;
  path: string;
  promptPath: string;
  tags: string[];
}

/**
 * List MDS item folders (dirs containing prompt.md) under `dir`, recursively.
 * Item tags come from each item's own prompt.json (not from folder location).
 */
export async function listScopeItems(dir: string): Promise<ScopeItem[]> {
  const items: ScopeItem[] = [];
  async function walk(d: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(d, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const mdPath = join(full, "prompt.md");
      const jsonPath = join(full, "prompt.json");
      if (existsSync(mdPath)) {
        let tags: string[] = [];
        try {
          const raw = await readFile(jsonPath, "utf-8");
          const parsed = JSON.parse(raw) as { tags?: unknown };
          tags = Array.isArray(parsed.tags)
            ? parsed.tags.filter((t): t is string => typeof t === "string")
            : [];
        } catch {
          // no prompt.json — no tags
        }
        items.push({ name: e.name, relPath: childRel, path: full, promptPath: mdPath, tags });
      } else {
        await walk(full, childRel);
      }
    }
  }
  await walk(dir, "");
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Walk a directory recursively, returning a full tree (dirs first, then files, alphabetical). */
export async function walkDir(dir: string): Promise<ScopeDirNode[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nodes: ScopeDirNode[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        nodes.push({
          name: e.name,
          type: "dir",
          ext: "",
          isItem: existsSync(join(dir, e.name, "prompt.md")),
          children: await walkDir(join(dir, e.name)),
        });
      } else if (e.isFile()) {
        const ext = extname(e.name).replace(/^\./, "").toLowerCase();
        nodes.push({ name: e.name, type: "file", ext, children: [] });
      }
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

/**
 * Bump `updatedAt` in the prompt.json inside `folder` (if it exists).
 * Preserves every other field. Safe when the edited file IS prompt.json.
 */
export async function bumpPromptJson(folder: string): Promise<void> {
  const jsonPath = join(folder, "prompt.json");
  if (!existsSync(jsonPath)) return;
  try {
    const raw = await readFile(jsonPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    data.updatedAt = new Date().toISOString();
    await writeFile(jsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.warn(
      `[mds] failed to bump prompt.json ${jsonPath}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/** Reserved top-level MDS dirs — auto-created in every scope, protected from delete/rename. */
export const RESERVED_MDS_DIRS = new Set(["_skills", "_SystemBase"]);

/** Ensure the default reserved folders exist in a scope dir (global / project / session). */
export async function ensureDefaultMdsDirs(dir: string, mode: string): Promise<void> {
  for (const name of RESERVED_MDS_DIRS) {
    await mkdir(join(dir, name), { recursive: true });
  }
  // Seed _SystemBase/{name}/prompt.md + prompt.json from the repo seeds when available (fresh installs only).
  // _SystemBase is a container: the prompt lives in a sub-folder, like _skills.
  const itemDir = join(dir, "_SystemBase", "systemPromptBase");
  const mdPath = join(itemDir, "prompt.md");
  if (!existsSync(mdPath)) {
    const sDir = seedsDir();
    if (sDir) {
      try {
        const seed = await readFile(
          join(sDir, seedSubdirForMode(mode), "mds", "systemPromptBase.md"),
          "utf-8"
        );
        await mkdir(itemDir, { recursive: true });
        await writeFile(mdPath, seed, "utf-8");
        // Seed prompt.json metadata alongside the md
        const now = new Date().toISOString();
        const jsonPath = join(itemDir, "prompt.json");
        if (!existsSync(jsonPath)) {
          await writeFile(
            jsonPath,
            JSON.stringify({ createdAt: now, updatedAt: now, tags: ["system-base"] }, null, 2) + "\n",
            "utf-8"
          );
        }
      } catch {
        // no seed file — leave _SystemBase empty
      }
    }
  }
}

/** Recursively copy a directory tree. Uses mkdir + readdir + copyFile. */
export async function copyRecursive(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) {
      await copyRecursive(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

/**
 * Update paths in config.json and agents/*.json: replace oldPrefix with newPrefix.
 * Best-effort — never throws.
 */
export async function updateMdsPathPrefix(
  resolvedDataDir: string,
  oldPrefix: string,
  newPrefix: string
): Promise<void> {
  // Update config.json
  const configPath = join(resolvedDataDir, "config.json");
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agents = config.agents as Record<string, Record<string, unknown>> | undefined;
    let changed = false;
    if (agents && typeof agents === "object") {
      for (const key of Object.keys(agents)) {
        const a = agents[key];
        if (!a || typeof a !== "object") continue;
        const amd = a.agentMd as Record<string, unknown> | undefined;
        if (amd?.path && typeof amd.path === "string" && (amd.path as string).startsWith(oldPrefix)) {
          amd.path = (amd.path as string).replace(oldPrefix, newPrefix);
          changed = true;
        }
        const skills = a.skillMds as Record<string, unknown>[] | undefined;
        if (Array.isArray(skills)) {
          for (const sk of skills) {
            if (sk.path && typeof sk.path === "string" && (sk.path as string).startsWith(oldPrefix)) {
              sk.path = (sk.path as string).replace(oldPrefix, newPrefix);
              changed = true;
            }
          }
        }
      }
    }
    if (changed) {
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    }
  } catch { /* best-effort */ }

  // Update agents/{key}.json
  const agentsDir = join(resolvedDataDir, "agents");
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const fp = join(agentsDir, e.name);
      try {
        const raw = await readFile(fp, "utf-8");
        const settings = JSON.parse(raw) as Record<string, unknown>;
        let changed = false;
        const amd = settings.agentMd as Record<string, unknown> | undefined;
        if (amd?.path && typeof amd.path === "string" && (amd.path as string).startsWith(oldPrefix)) {
          amd.path = (amd.path as string).replace(oldPrefix, newPrefix);
          changed = true;
        }
        const skills = settings.skillMds as Record<string, unknown>[] | undefined;
        if (Array.isArray(skills)) {
          for (const sk of skills) {
            if (sk.path && typeof sk.path === "string" && (sk.path as string).startsWith(oldPrefix)) {
              sk.path = (sk.path as string).replace(oldPrefix, newPrefix);
              changed = true;
            }
          }
        }
        if (changed) await writeFile(fp, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      } catch { /* skip unreadable */ }
    }
  } catch { /* agents dir may not exist */ }
}

/** Validate a relative path: no `..`, no traversal, no empty segments. Returns normalized path or null. */
export function safeRelPath(rel: string | undefined): string | null {
  if (!rel) return null;
  const normalized = rel.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.length > 200) return null;
  const segments = normalized.split("/");
  if (segments.some((s) => !s || s === "." || s === "..")) return null;
  return normalized;
}

/** Resolve the data dir + workspace root for scope routes (workspace falls back to the session's). */
export async function resolveMdsContext(q: { sessionId?: string; workspaceRoot?: string }) {
  const { dataDir: resolvedDataDir } = resolveDataDirInfo();
  let wsRoot = (q.workspaceRoot || "").trim();
  if (q.sessionId) {
    const session = await getSession(resolvedDataDir, q.sessionId);
    if (session?.meta?.workspaceRoot) wsRoot = session.meta.workspaceRoot;
  }
  return { resolvedDataDir, wsRoot };
}
