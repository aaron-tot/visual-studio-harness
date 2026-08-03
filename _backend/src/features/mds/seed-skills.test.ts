import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { seedToolSkills, TOOL_SKILL_NAMES } from "./scope";
import { seedsDir, seedSubdirForMode } from "./paths";

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vsh-seed-test-"));
}

/** Build a fake seeds tree ({mode}/mds/_skills/{name}/{prompt.md,prompt.json}) in a temp dir. */
async function makeFakeSeeds(mode: string, skills: Record<string, string>): Promise<string> {
  const root = await makeTempDir();
  const skillsRoot = join(root, seedSubdirForMode(mode), "mds", "_skills");
  for (const [name, content] of Object.entries(skills)) {
    const dir = join(skillsRoot, name);
    await writeFile(join(dir, "prompt.md"), content, "utf-8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "prompt.md"), content, "utf-8");
    });
    await writeFile(join(dir, "prompt.json"), JSON.stringify({ name, tags: [] }, null, 2) + "\n", "utf-8");
  }
  return root;
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
    // dev and packageAndProd both have mds/_skills seed trees shipped in the repo
    for (const mode of ["dev", "packageAndProd"]) {
      const skillsRoot = join(sDir!, seedSubdirForMode(mode), "mds", "_skills");
      expect(existsSync(skillsRoot)).toBe(true);
    }
  });

  test("every TOOL_SKILL_NAMES entry has a prompt.md seed in dev mode", () => {
    const sDir = seedsDir();
    const skillsRoot = join(sDir!, seedSubdirForMode("dev"), "mds", "_skills");
    for (const name of TOOL_SKILL_NAMES) {
      expect(existsSync(join(skillsRoot, name, "prompt.md"))).toBe(true);
    }
  });
});
