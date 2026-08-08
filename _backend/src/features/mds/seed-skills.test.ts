import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { ensureDefaultMdsDirs, migrateToolSkills, TOOL_SKILL_NAMES } from "./scope";
import { seedsDir, seedSubdirForMode } from "./paths";

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vsh-seed-test-"));
}

describe("TOOL_SKILL_NAMES", () => {
  test("includes the expected tool skills", () => {
    expect(TOOL_SKILL_NAMES).toContain("apply-patch");
    expect(TOOL_SKILL_NAMES).toContain("task");
    expect(TOOL_SKILL_NAMES).toContain("websearch");
  });
});

describe("seeds layout", () => {
  test("seedsDir resolves to the repo seeds directory under both modes", () => {
    const sDir = seedsDir();
    expect(sDir).toBeTruthy();
    // dev and packageAndProd both ship builtin-tools guide seeds (skill.md + prompt.json)
    for (const mode of ["dev", "packageAndProd"]) {
      const seedDir = join(sDir!, seedSubdirForMode(mode), "builtin-tools", "todo");
      expect(existsSync(join(seedDir, "skill.md"))).toBe(true);
      expect(existsSync(join(seedDir, "prompt.json"))).toBe(true);
    }
  });

  test("guide-bearing builtin tools have a skill.md seed in dev mode", () => {
    const sDir = seedsDir();
    for (const name of ["apply_patch", "audit", "design", "graph", "knowledge", "searchLocal", "searchOnline", "task", "todo"]) {
      const seedDir = join(sDir!, seedSubdirForMode("dev"), "builtin-tools", name);
      expect(existsSync(join(seedDir, "skill.md")), `${name} skill.md seed`).toBe(true);
      expect(existsSync(join(seedDir, "prompt.json")), `${name} prompt.json seed`).toBe(true);
    }
  });
});

describe("ensureDefaultMdsDirs", () => {
  test("no longer seeds tool skills into _tools (unified-tools: guides live in data/tools)", async () => {
    const root = await makeTempDir();
    try {
      const globalDir = join(root, "mds");
      await ensureDefaultMdsDirs(globalDir, "dev");

      // _tools may still be created as a reserved MDS dir, but it must NOT be
      // populated with seeded <name>.skill.md / <name>.prompt.json files.
      const toolsDir = join(globalDir, "_tools");
      if (existsSync(toolsDir)) {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(toolsDir, { withFileTypes: true });
        const skillFiles = entries.filter(
          (e) => e.isFile() && (e.name.endsWith(".skill.md") || e.name.endsWith(".prompt.json"))
        );
        expect(skillFiles).toEqual([]);
      }

      // The system base seeding still works.
      expect(existsSync(join(globalDir, "_SystemBase", "systemPromptBase", "prompt.md"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("migrateToolSkills", () => {
  test("moves legacy _skills/<name>/{prompt.md,prompt.json} into _tools/<name>/<name>.skill.md + <name>.prompt.json", async () => {
    const root = await makeTempDir();
    const skillsDir = join(root, "_skills");
    const toolsDir = join(root, "_tools");
    // Legacy layout for two known tool skills
    for (const name of ["todo", "task"]) {
      await writeFile(join(skillsDir, name, "prompt.md"), `# ${name} guide`, "utf-8").catch(async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(skillsDir, name), { recursive: true });
        await writeFile(join(skillsDir, name, "prompt.md"), `# ${name} guide`, "utf-8");
      });
      await writeFile(join(skillsDir, name, "prompt.json"), JSON.stringify({ name, tags: ["x"] }, null, 2) + "\n", "utf-8");
    }

    await migrateToolSkills(root);

    // New layout present
    expect(existsSync(join(toolsDir, "todo", "todo.skill.md"))).toBe(true);
    expect(existsSync(join(toolsDir, "todo", "todo.prompt.json"))).toBe(true);
    expect(existsSync(join(toolsDir, "task", "task.skill.md"))).toBe(true);
    // Old folders removed
    expect(existsSync(join(skillsDir, "todo"))).toBe(false);
    expect(existsSync(join(skillsDir, "task"))).toBe(false);
    // Content preserved
    expect(await readFile(join(toolsDir, "todo", "todo.skill.md"), "utf-8")).toBe("# todo guide");
  });

  test("removes the legacy _skills/<name> folder even when the _tools target was already seeded", async () => {
    const root = await makeTempDir();
    const skillsDir = join(root, "_skills");
    const toolsDir = join(root, "_tools");
    // Legacy source still present
    await writeFile(join(skillsDir, "todo", "prompt.md"), "# OLD", "utf-8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(skillsDir, "todo"), { recursive: true });
      await writeFile(join(skillsDir, "todo", "prompt.md"), "# OLD", "utf-8");
    });
    // Target already seeded
    await writeFile(join(toolsDir, "todo", "todo.skill.md"), "# NEW", "utf-8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(toolsDir, "todo"), { recursive: true });
      await writeFile(join(toolsDir, "todo", "todo.skill.md"), "# NEW", "utf-8");
    });

    await migrateToolSkills(root);

    expect(existsSync(join(skillsDir, "todo"))).toBe(false); // legacy removed
    expect(await readFile(join(toolsDir, "todo", "todo.skill.md"), "utf-8")).toBe("# NEW"); // seeded kept
  });
});
