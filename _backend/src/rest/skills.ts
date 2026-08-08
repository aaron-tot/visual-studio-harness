import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { discoverSkills } from "../features/tools/builtins/skill";

export function registerSkillsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/skills", async () => {
    // The three locations the skill tool discovers: generic skills (_skills),
    // builtin tool guides (tools/builtin/<name>/skill.md), custom tool guides
    // (tools/custom/<name>/skill.md). Discovery delegates to the skill tool's
    // walker so a tool folder's `skill.md` is surfaced as a tool-skill.
    const roots = [
      join(dataDir, "mds", "_skills"),
      join(dataDir, "tools", "builtin"),
      join(dataDir, "tools", "custom"),
    ];
    const skills = await discoverSkills(roots, 3);
    return Array.from(new Set(skills.map((s) => s.name))).sort();
  });
}
