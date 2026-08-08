import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, relative } from "node:path";
import { existsSync } from "node:fs";
import type { ToolDef } from "../types";
import { SandboxError } from "../sandbox";
import { truncateText } from "../format";

const MAX_SKILL_BYTES = 32 * 1024;
const DEFAULT_MAX_DEPTH = 3;

/** Search roots for skills (ordered). Set from chat/runtime. */
export let skillRoots: string[] = [];

/** Custom tools directory for skill guides. */
export let customToolsSkillDir: string | null = null;

export function setSkillRoots(roots: string[]) {
  skillRoots = roots;
}

export function setCustomToolsSkillDir(dir: string | null) {
  customToolsSkillDir = dir;
}

/** Discovered skill information. */
export interface SkillInfo {
  name: string;           // Folder name containing the skill marker
  path: string;           // Absolute path to the skill folder (or the .skill.md/skill.md guide file for tool-skills)
  depth: number;          // Depth from root (0 = direct child)
  root: string;           // Root it was found under
  marker: "SKILL.md" | "prompt.md" | "loose-md" | "tool-skill";
  hasPromptJson: boolean;
  tags: string[];
}

/** Cached discovery results with timestamp for TTL invalidation. */
let skillDiscoveryCache: { skills: SkillInfo[]; timestamp: number; cacheKey: string } | null = null;
const SKILL_CACHE_TTL = 30_000; // 30 seconds

function makeCacheKey(roots: string[], maxDepth: number): string {
  return `${roots.join(",")}|${maxDepth}`;
}

async function readPromptJsonTags(skillPath: string): Promise<string[]> {
  try {
    const raw = await readFile(join(skillPath, "prompt.json"), "utf-8");
    const parsed = JSON.parse(raw) as { tags?: unknown };
    return Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

/** Read tags from a sibling `<name>.prompt.json` next to a `.skill.md` tool-skill file. */
async function readSiblingTags(dir: string, name: string): Promise<string[]> {
  try {
    const raw = await readFile(join(dir, `${name}.prompt.json`), "utf-8");
    const parsed = JSON.parse(raw) as { tags?: unknown };
    return Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

const walkDir = async (
  dir: string,
  currentDepth: number,
  maxDepth: number,
  root: string,
  skills: SkillInfo[]
): Promise<void> => {
  if (currentDepth > maxDepth) return;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const fullPath = join(dir, e.name);
        const skillMd = join(fullPath, "SKILL.md");
        const promptMd = join(fullPath, "prompt.md");
        const toolSkillMd = join(fullPath, "skill.md");
        const hasSkillMd = existsSync(skillMd);
        const hasPromptMd = existsSync(promptMd);
        const hasToolSkillMd = existsSync(toolSkillMd);

        if (hasSkillMd || hasPromptMd) {
          const tags = await readPromptJsonTags(fullPath);
          skills.push({
            name: e.name,
            path: fullPath,
            depth: currentDepth,
            root,
            marker: hasSkillMd ? "SKILL.md" : "prompt.md",
            hasPromptJson: existsSync(join(fullPath, "prompt.json")),
            tags,
          });
        } else if (hasToolSkillMd) {
          // Tool skill guide folder — data/tools/{builtin,custom}/<name>/skill.md.
          // The skill.md file IS the guide; tags come from the folder's prompt.json.
          skills.push({
            name: e.name,
            path: toolSkillMd,
            depth: currentDepth,
            root,
            marker: "tool-skill",
            hasPromptJson: existsSync(join(fullPath, "prompt.json")),
            tags: await readPromptJsonTags(fullPath),
          });
        }
        // Always recurse into subdirectories
        await walkDir(fullPath, currentDepth + 1, maxDepth, root, skills);
      } else if (e.isFile() && e.name.endsWith(".skill.md")) {
        // Tool skill guide — legacy builtin (_tools/<name>/) or custom
        // (custom-tools/<name>.skill.md) layouts. The .skill.md file IS the guide.
        const fullPath = join(dir, e.name);
        const name = basename(e.name, ".skill.md");
        skills.push({
          name,
          path: fullPath,
          depth: currentDepth,
          root,
          marker: "tool-skill",
          hasPromptJson: existsSync(join(dir, `${name}.prompt.json`)),
          tags: await readSiblingTags(dir, name),
        });
      } else if (e.isFile() && e.name.endsWith(".md") && currentDepth === 0) {
        // Loose .md files only at root level (legacy)
        const fullPath = join(dir, e.name);
        skills.push({
          name: basename(e.name, ".md"),
          path: fullPath,
          depth: 0,
          root,
          marker: "loose-md",
          hasPromptJson: false,
          tags: [],
        });
      }
    }
  } catch {
    // Ignore unreadable directories
  }
};

/**
 * Discover skills under the given roots (shared by the /api/skills REST endpoint
 * and the compiled skill tool). Exported so the REST layer and tests use the
 * exact same walker — a tool folder's `skill.md` guide is discovered as a
 * `tool-skill` marker with tags from the folder's `prompt.json`.
 */
export async function discoverSkills(roots: string[], maxDepth: number = DEFAULT_MAX_DEPTH): Promise<SkillInfo[]> {
  const cacheKey = makeCacheKey(roots, maxDepth);
  const now = Date.now();

  if (skillDiscoveryCache && skillDiscoveryCache.cacheKey === cacheKey && now - skillDiscoveryCache.timestamp < SKILL_CACHE_TTL) {
    return skillDiscoveryCache.skills;
  }

  const skills: SkillInfo[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    await walkDir(root, 0, maxDepth, root, skills);
  }

  skillDiscoveryCache = { skills, timestamp: now, cacheKey };
  return skills;
}

function resolveSkillName(name: string, roots: string[], maxDepth: number, allSkills: SkillInfo[]): SkillInfo | null {
  // Try path-like resolution first (e.g., "coding/debugging")
  if (name.includes("/")) {
    const segments = name.split("/").filter(Boolean);
    for (const root of roots) {
      const candidate = join(root, ...segments);
      // Check if this directory contains a skill marker
      const skillMd = join(candidate, "SKILL.md");
      const promptMd = join(candidate, "prompt.md");
      if (existsSync(skillMd) || existsSync(promptMd)) {
        const found = allSkills.find(s => s.path === candidate);
        if (found) return found;
        // Fallback: construct SkillInfo on the fly
        return {
          name: segments[segments.length - 1],
          path: candidate,
          depth: segments.length - 1,
          root,
          marker: existsSync(skillMd) ? "SKILL.md" : "prompt.md",
          hasPromptJson: existsSync(join(candidate, "prompt.json")),
          tags: [], // Would need async to get tags, skip for fast path
        };
      }
    }
  }

  // Fallback: exact name match on folder name
  return allSkills.find(s => s.name === name) || null;
}

async function getAvailableNames(roots: string[], maxDepth: number): Promise<string[]> {
  const skills = await discoverSkills(roots, maxDepth);
  return Array.from(new Set(skills.map(s => s.name))).sort();
}

export const skillTool: ToolDef = {
  name: "skill",
  description:
    "Load a skill markdown pack into context by name (on-demand). Supports recursive search, path-like names (e.g., 'coding/debugging'), and multiple return modes.",
  permissionDefault: "allow",
  outputFields: [
    { name: "name", type: "string", description: "Skill that was loaded", required: true },
    { name: "path", type: "string", description: "Filesystem path to the skill folder", required: false },
    { name: "depth", type: "number", description: "Depth from skill root", required: false },
    { name: "tags", type: "array", description: "Tags from prompt.json", required: false },
  ],
  inputSchema: z.object({
    name: z.string().optional().describe("Skill name or path (e.g., 'debugging' or 'coding/debugging'). Omit for list mode."),
    mode: z.enum(["content", "path", "meta", "list"]).default("content").describe("Return mode: content (default), path (folder only), meta (metadata), list (all skills)"),
    maxDepth: z.number().int().min(1).max(10).default(DEFAULT_MAX_DEPTH).describe("Max directory depth to search"),
    filter: z.string().optional().describe("Substring filter on skill name (list mode only)"),
    tags: z.array(z.string()).optional().describe("Filter by tags from prompt.json (list mode only)"),
    root: z.string().optional().describe("Override skillRoots — search only this root"),
  }),
  execute: async (args, ctx: import("../types").BaseToolContext) => {
    // Discovery roots: an explicit `root` wins; otherwise use whatever was
    // wired via setSkillRoots/setCustomToolsSkillDir. When nothing was wired
    // (the compiled builtin is superseded by the folder entry at runtime; kept
    // consistent), fall back to generic skills under mds/_skills plus tool
    // guides under data/tools.
    const roots = args.root
      ? [args.root]
      : skillRoots.length > 0 || customToolsSkillDir
        ? [...skillRoots, ...(customToolsSkillDir ? [customToolsSkillDir] : [])]
        : [
            join(ctx.dataDir, "mds", "_skills"),
            join(ctx.dataDir, "tools", "builtin"),
            join(ctx.dataDir, "tools", "custom"),
          ];
    const maxDepth = args.maxDepth ?? DEFAULT_MAX_DEPTH;
    const allSkills = await discoverSkills(roots, maxDepth);

    // Access control (skillAccess). "attached" = the agent's skillMds names PLUS all
    // tool skills (builtin + custom) — tool skills are always loadable. Generic
    // (non-tool) skills are only loadable when named in skillMds.
    const access = ctx.agentSettings?.skillAccess ?? "all";
    let allowed: Set<string> | null = null;
    if (access === "attached") {
      allowed = new Set<string>();
      for (const skill of ctx.agentSettings?.skillMds ?? []) {
        if (skill.name) allowed.add(skill.name);
        if (skill.path) {
          const parts = skill.path.split("/").filter(Boolean);
          if (parts.length > 0) allowed.add(parts[parts.length - 1]);
        }
      }
      for (const s of allSkills) {
        if (s.marker === "tool-skill") allowed.add(s.name);
      }
    }

    // List mode — return all skills with optional filtering (respects access control)
    if (args.mode === "list") {
      let filtered = allSkills;
      if (args.filter) {
        const f = args.filter.toLowerCase();
        filtered = filtered.filter(s => s.name.toLowerCase().includes(f));
      }
      if (args.tags && args.tags.length > 0) {
        filtered = filtered.filter(s => args.tags!.some(t => s.tags.includes(t)));
      }
      if (allowed) {
        filtered = filtered.filter(s => allowed!.has(s.name));
      }
      return {
        title: "Skills List",
        output: JSON.stringify({
          skills: filtered.map(s => ({
            name: s.name,
            path: s.path,
            depth: s.depth,
            root: s.root,
            marker: s.marker,
            tags: s.tags,
          })),
          total: filtered.length,
        }, null, 2),
        metadata: { mode: "list", count: filtered.length },
      };
    }

    // Other modes require a name
    if (!args.name) {
      throw new SandboxError("ERROR skill: 'name' is required for mode 'content', 'path', or 'meta'");
    }
    if (allowed && !allowed.has(args.name)) {
      const allowedList = Array.from(allowed).join(", ") || "(none)";
      throw new SandboxError(
        `ERROR skill: '${args.name}' not in allowed skills for this agent. Allowed: ${allowedList || "(none)"}`
      );
    }

    const skill = resolveSkillName(args.name, roots, maxDepth, allSkills);
    if (!skill) {
      const available = await getAvailableNames(roots, maxDepth);
      throw new SandboxError(
        `ERROR skill: '${args.name}' not found. Available: ${available.slice(0, 40).join(", ") || "(none)"}`
      );
    }

    // Path mode — return folder path only
    if (args.mode === "path") {
      return {
        title: skill.name,
        output: skill.path,
        metadata: { name: skill.name, path: skill.path, mode: "path" },
      };
    }

    // Meta mode — return metadata without content
    if (args.mode === "meta") {
      // Read tags if not already present
      let tags = skill.tags;
      if (tags.length === 0 && skill.hasPromptJson) {
        tags = await readPromptJsonTags(skill.path);
      }
      return {
        title: skill.name,
        output: JSON.stringify({
          name: skill.name,
          path: skill.path,
          depth: skill.depth,
          root: skill.root,
          marker: skill.marker,
          hasPromptJson: skill.hasPromptJson,
          tags,
        }, null, 2),
        metadata: { name: skill.name, path: skill.path, mode: "meta" },
      };
    }

    // Content mode (default) — read the markdown file
    let filePath: string;
    if (skill.marker === "tool-skill") {
      // For tool skills, the path IS the markdown file
      filePath = skill.path;
    } else {
      const markerFile = skill.marker === "SKILL.md" ? "SKILL.md" : "prompt.md";
      filePath = join(skill.path, markerFile);
    }
    const raw = await readFile(filePath, "utf-8");
    const { text, truncated } = truncateText(raw, MAX_SKILL_BYTES);

    return {
      title: skill.name,
      output: truncated
        ? `# Skill: ${skill.name}\n\n${text}`
        : `# Skill: ${skill.name}\n\n${text}`,
      metadata: { path: skill.path, truncated, depth: skill.depth, marker: skill.marker },
    };
  },
};
