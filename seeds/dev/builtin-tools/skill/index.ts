/**
 * Builtin `skill` tool — self-contained ctx entry.
 * Discovers and reads skills (SKILL.md / prompt.md folders, loose .md, and
 * `.skill.md` tool-skill guides, plus `skill.md` inside tool folders). Discovery
 * roots come from `ctx.skillRoots` when present; otherwise the entry falls back
 * to the default `mds/_skills` root under `ctx.dataDir`. `dataDir/tools` is
 * always appended so folder tool-skill guides (`data/tools/{builtin,custom}/<name>/skill.md`)
 * are discoverable. All harness helpers arrive via `ctx` (truncateText,
 * agentSettings); only node:fs/node:path are imported directly.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

const MAX_SKILL_BYTES = 32 * 1024;
const DEFAULT_MAX_DEPTH = 3;
const SKILL_CACHE_TTL = 30_000; // 30 seconds

type SkillMarker = "SKILL.md" | "prompt.md" | "loose-md" | "tool-skill";

interface SkillInfo {
  name: string;
  path: string;
  depth: number;
  root: string;
  marker: SkillMarker;
  hasPromptJson: boolean;
  tags: string[];
}

let skillDiscoveryCache: { skills: SkillInfo[]; timestamp: number; cacheKey: string } | null = null;

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
        await walkDir(fullPath, currentDepth + 1, maxDepth, root, skills);
      } else if (e.isFile() && e.name.endsWith(".skill.md")) {
        // Tool skill guide (legacy builtin _tools/<name>/ or custom-tools/ layout).
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

async function discoverSkills(roots: string[], maxDepth: number): Promise<SkillInfo[]> {
  const cacheKey = makeCacheKey(roots, maxDepth);
  const now = Date.now();

  if (
    skillDiscoveryCache &&
    skillDiscoveryCache.cacheKey === cacheKey &&
    now - skillDiscoveryCache.timestamp < SKILL_CACHE_TTL
  ) {
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

function resolveSkillName(
  name: string,
  roots: string[],
  maxDepth: number,
  allSkills: SkillInfo[]
): SkillInfo | null {
  if (name.includes("/")) {
    const segments = name.split("/").filter(Boolean);
    for (const root of roots) {
      const candidate = join(root, ...segments);
      const skillMd = join(candidate, "SKILL.md");
      const promptMd = join(candidate, "prompt.md");
      if (existsSync(skillMd) || existsSync(promptMd)) {
        const found = allSkills.find((s) => s.path === candidate);
        if (found) return found;
        return {
          name: segments[segments.length - 1]!,
          path: candidate,
          depth: segments.length - 1,
          root,
          marker: existsSync(skillMd) ? "SKILL.md" : "prompt.md",
          hasPromptJson: existsSync(join(candidate, "prompt.json")),
          tags: [],
        };
      }
    }
  }
  return allSkills.find((s) => s.name === name) || null;
}

async function getAvailableNames(roots: string[], maxDepth: number): Promise<string[]> {
  const skills = await discoverSkills(roots, maxDepth);
  return Array.from(new Set(skills.map((s) => s.name))).sort();
}

/** Default skill roots when ctx.skillRoots is not set (fallback = mds dirs). */
function defaultSkillRoots(ctx: any): string[] {
  return [join(ctx.dataDir, "mds", "_skills")];
}

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const rawRoots = Array.isArray(ctx.skillRoots) && ctx.skillRoots.length > 0 ? ctx.skillRoots : defaultSkillRoots(ctx);
  const roots = args.root
    ? [String(args.root)]
    : [...rawRoots, join(ctx.dataDir, "tools")];
  const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : DEFAULT_MAX_DEPTH;
  const allSkills = await discoverSkills(roots, maxDepth);

  // Access control (skillAccess). "attached" = the agent's skillMds names PLUS
  // all tool skills — tool skills are always loadable.
  const access = ctx.agentSettings?.skillAccess ?? "all";
  let allowed: Set<string> | null = null;
  if (access === "attached") {
    allowed = new Set<string>();
    for (const skill of ctx.agentSettings?.skillMds ?? []) {
      if (skill.name) allowed.add(skill.name);
      if (skill.path) {
        const parts = skill.path.split("/").filter(Boolean);
        if (parts.length > 0) allowed.add(parts[parts.length - 1]!);
      }
    }
    for (const s of allSkills) {
      if (s.marker === "tool-skill") allowed.add(s.name);
    }
  }

  if (args.mode === "list") {
    let filtered = allSkills;
    if (args.filter) {
      const f = String(args.filter).toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(f));
    }
    if (Array.isArray(args.tags) && args.tags.length > 0) {
      const want = args.tags.map(String);
      filtered = filtered.filter((s) => want.some((t) => s.tags.includes(t)));
    }
    if (allowed) {
      filtered = filtered.filter((s) => allowed!.has(s.name));
    }
    return {
      title: "Skills List",
      output: JSON.stringify(
        {
          skills: filtered.map((s) => ({
            name: s.name,
            path: s.path,
            depth: s.depth,
            root: s.root,
            marker: s.marker,
            tags: s.tags,
          })),
          total: filtered.length,
        },
        null,
        2
      ),
      metadata: { mode: "list", count: filtered.length },
    };
  }

  if (!args.name) {
    return {
      title: "skill",
      output: "ERROR skill: 'name' is required for mode 'content', 'path', or 'meta'",
      isError: true,
    };
  }
  if (allowed && !allowed.has(args.name as string)) {
    const allowedList = Array.from(allowed).join(", ") || "(none)";
    return {
      title: "skill",
      output: `ERROR skill: '${args.name}' not in allowed skills for this agent. Allowed: ${allowedList || "(none)"}`,
      isError: true,
    };
  }

  const skill = resolveSkillName(String(args.name), roots, maxDepth, allSkills);
  if (!skill) {
    const available = await getAvailableNames(roots, maxDepth);
    return {
      title: "skill",
      output: `ERROR skill: '${args.name}' not found. Available: ${available.slice(0, 40).join(", ") || "(none)"}`,
      isError: true,
    };
  }

  if (args.mode === "path") {
    return {
      title: skill.name,
      output: skill.path,
      metadata: { name: skill.name, path: skill.path, mode: "path" },
    };
  }

  if (args.mode === "meta") {
    let tags = skill.tags;
    if (tags.length === 0 && skill.hasPromptJson) {
      tags = await readPromptJsonTags(skill.path);
    }
    return {
      title: skill.name,
      output: JSON.stringify(
        {
          name: skill.name,
          path: skill.path,
          depth: skill.depth,
          root: skill.root,
          marker: skill.marker,
          hasPromptJson: skill.hasPromptJson,
          tags,
        },
        null,
        2
      ),
      metadata: { name: skill.name, path: skill.path, mode: "meta" },
    };
  }

  // Content mode (default)
  let filePath: string;
  if (skill.marker === "tool-skill") {
    filePath = skill.path;
  } else {
    const markerFile = skill.marker === "SKILL.md" ? "SKILL.md" : "prompt.md";
    filePath = join(skill.path, markerFile);
  }
  const raw = await readFile(filePath, "utf-8");
  const { text, truncated } = ctx.truncateText(raw, MAX_SKILL_BYTES);

  return {
    title: skill.name,
    output: `# Skill: ${skill.name}\n\n${text}`,
    metadata: { path: skill.path, truncated, depth: skill.depth, marker: skill.marker },
  };
}
