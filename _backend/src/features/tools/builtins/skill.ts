import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { truncateText } from "../format";

const MAX_SKILL_BYTES = 32 * 1024;

/** Search roots for skills (ordered). Set from chat/runtime. */
export let skillRoots: string[] = [];

export function setSkillRoots(roots: string[]) {
  skillRoots = roots;
}

async function listSkillNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const root of skillRoots) {
    if (!existsSync(root)) continue;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const skillMd = join(root, e.name, "SKILL.md");
          if (existsSync(skillMd)) names.add(e.name);
        } else if (e.isFile() && e.name.endsWith(".md")) {
          names.add(basename(e.name, ".md"));
        }
      }
    } catch {
      // ignore
    }
  }
  return [...names].sort();
}

async function resolveSkillFile(name: string): Promise<string | null> {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) return null;
  for (const root of skillRoots) {
    const candidates = [
      join(root, safe, "SKILL.md"),
      join(root, `${safe}.md`),
      join(root, safe),
    ];
    for (const c of candidates) {
      try {
        const st = await stat(c);
        if (st.isFile()) return c;
      } catch {
        // continue
      }
    }
  }
  return null;
}

export const skillTool: ToolDef = {
  name: "skill",
  description:
    "Load a skill markdown pack into context by name (on-demand). Use when a specialized procedure is needed. Call without assuming skills are already in the system prompt.",
  permissionDefault: "allow",
  outputFields: [
    { name: "name", type: "string", description: "Name of the skill that was loaded", required: true },
    { name: "path", type: "string", description: "Filesystem path to the skill file", required: false },
  ],
  inputSchema: z.object({
    name: z.string().describe("Skill id / folder name / markdown basename"),
  }),
  execute: async (args) => {
    const available = await listSkillNames();
    const file = await resolveSkillFile(args.name);
    if (!file) {
      throw new SandboxError(
        `ERROR skill: '${args.name}' not found. Available: ${available.slice(0, 40).join(", ") || "(none)"}`
      );
    }
    const raw = await readFile(file, "utf-8");
    const { text, truncated } = truncateText(raw, MAX_SKILL_BYTES);
    return {
      title: args.name,
      output: truncated
        ? `# Skill: ${args.name}\n\n${text}`
        : `# Skill: ${args.name}\n\n${text}`,
      metadata: { path: file, truncated },
    };
  },
};

// Refresh description with available skills when registry builds — static description is fine;
// list is also returned on miss.
