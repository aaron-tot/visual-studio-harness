import type { FastifyInstance } from "fastify";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export function registerSkillsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/skills", async () => {
    const names = new Set<string>();
    // All three locations the skill tool discovers: generic skills (_skills),
    // builtin tool skills (_tools/<name>/<name>.skill.md), custom tool skills
    // (custom-tools/<name>.skill.md).
    const roots = [join(dataDir, "mds", "_skills"), join(dataDir, "mds", "_tools"), join(dataDir, "custom-tools")];
    for (const dir of roots) {
      if (!existsSync(dir)) continue;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const inFolder = [
              join(dir, e.name, `${e.name}.skill.md`),
              join(dir, e.name, "prompt.md"),
              join(dir, e.name, "SKILL.md"),
            ];
            if (inFolder.some((p) => existsSync(p))) names.add(e.name);
          } else if (e.isFile() && e.name.endsWith(".skill.md")) {
            names.add(e.name.replace(/\.skill\.md$/, ""));
          } else if (e.isFile() && e.name.endsWith(".md") && dir !== join(dataDir, "custom-tools")) {
            names.add(e.name.replace(/\.md$/, ""));
          }
        }
      } catch {
        // ignore
      }
    }
    return [...names].sort();
  });
}
