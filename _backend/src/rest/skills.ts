import type { FastifyInstance } from "fastify";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export function registerSkillsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/skills", async () => {
    const names = new Set<string>();
    const skillsDir = join(dataDir, "skills");
    if (existsSync(skillsDir)) {
      try {
        const entries = await readdir(skillsDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const skillMd = join(skillsDir, e.name, "SKILL.md");
            if (existsSync(skillMd)) names.add(e.name);
          } else if (e.isFile() && e.name.endsWith(".md")) {
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
