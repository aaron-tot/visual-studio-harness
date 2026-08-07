import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { seedToolSkills, migrateToolSkills, TOOL_SKILL_NAMES } from "./scope";
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
    // dev and packageAndProd both have mds/_tools seed trees shipped in the repo
    for (const mode of ["dev", "packageAndProd"]) {
      const toolsRoot = join(sDir!, seedSubdirForMode(mode), "mds", "_tools");
      expect(existsSync(toolsRoot)).toBe(true);
    }
  });

  test("every TOOL_SKILL_NAMES entry has a <name>.skill.md seed in dev mode", () => {
    const sDir = seedsDir();
    const toolsRoot = join(sDir!, seedSubdirForMode("dev"), "mds", "_tools");
    for (const name of TOOL_SKILL_NAMES) {
      expect(existsSync(join(toolsRoot, name, `${name}.skill.md`))).toBe(true);
    }
  });
});

describe("seedToolSkills", () => {
  test("seeds builtin tool skills into _tools/<name>/ as <name>.skill.md + <name>.prompt.json", async () => {
    const root = await makeTempDir();
    const toolsDir = join(root, "mds", "_tools");
    await seedToolSkills(toolsDir, "dev");
    // Uses the real repo seeds (seeds/dev/mds/_tools/<name>/<name>.skill.md) — assert the
    // new folder-per-tool layout lands in the target.
    expect(existsSync(join(toolsDir, "todo", "todo.skill.md"))).toBe(true);
    expect(existsSync(join(toolsDir, "todo", "todo.prompt.json"))).toBe(true);
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
