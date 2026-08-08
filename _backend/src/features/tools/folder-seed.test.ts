import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { seedBuiltinToolFolders, setSeedRootForTest, setCopyFailureForTest } from "./folder-seed";
import { BUILTIN_TOOL_NAMES } from "./index";
import { seedsDir, seedSubdirForMode } from "../mds/paths";

describe("folder seed", () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-folder-seed-test-"));
    dataDir = join(testDir, "data");
    setSeedRootForTest(undefined); // use the real repo seeds by default
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    setSeedRootForTest(undefined);
    setCopyFailureForTest(undefined);
  });

  it("clones a folder for every builtin into a fresh data dir", async () => {
    const realSeedRoot = seedsDir();
    expect(realSeedRoot).toBeTruthy();

    const cloned = await seedBuiltinToolFolders(dataDir, "dev");

    // The real repo seed tree has a folder for every builtin.
    expect(cloned).toBe(BUILTIN_TOOL_NAMES.length);

    for (const name of BUILTIN_TOOL_NAMES) {
      const dir = join(dataDir, "tools", "builtin", name);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, `${name}.json`))).toBe(true);
      expect(existsSync(join(dir, "index.ts"))).toBe(true);
    }

    // The cloned config parses and round-trips the basic definition fields.
    const readCfg = JSON.parse(
      await readFile(join(dataDir, "tools", "builtin", "read", "read.json"), "utf-8")
    ) as Record<string, unknown>;
    expect(readCfg.name).toBe("read");
    expect(readCfg.entry).toBe("index.ts");
    expect(readCfg.enabled).toBe(true);
    expect(readCfg.permissionDefault).toBe("allow");
  });

  it("never overwrites an existing data folder (data copy is authoritative)", async () => {
    const realSeedRoot = seedsDir()!;
    const seedRead = join(realSeedRoot, seedSubdirForMode("dev"), "builtin-tools", "read");
    expect(existsSync(seedRead)).toBe(true);
    const originalSeed = await readFile(join(seedRead, "read.json"), "utf-8");

    // Pre-seed an EDITED data copy (sentinel description) before seeding.
    const target = join(dataDir, "tools", "builtin", "read");
    await mkdir(target, { recursive: true });
    const sentinel = {
      name: "read",
      description: "EDITED-SENTINEL",
      entry: "index.ts",
      inputSchema: { type: "object", properties: {} },
      enabled: true,
      permissionDefault: "ask",
    };
    await writeFile(join(target, "read.json"), JSON.stringify(sentinel, null, 2));
    await writeFile(join(target, "index.ts"), "export const edited = true;\n");

    const cloned = await seedBuiltinToolFolders(dataDir, "dev");

    // The existing folder was NOT cloned (count excludes it) and NOT clobbered.
    expect(cloned).toBe(BUILTIN_TOOL_NAMES.length - 1);
    const after = await readFile(join(target, "read.json"), "utf-8");
    expect((JSON.parse(after) as { description: string }).description).toBe(
      "EDITED-SENTINEL"
    );
    expect(after).not.toBe(originalSeed);
    expect(await readFile(join(target, "index.ts"), "utf-8")).toBe(
      "export const edited = true;\n"
    );
  });

  it("does not touch the custom tools group", async () => {
    const custom = join(dataDir, "tools", "custom", "my-tool");
    await mkdir(custom, { recursive: true });
    await writeFile(
      join(custom, "my-tool.json"),
      JSON.stringify({
        name: "my-tool",
        description: "User tool",
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(join(custom, "index.js"), "export async function execute() { return 'x'; }\n");

    await seedBuiltinToolFolders(dataDir, "dev");

    expect(existsSync(join(custom, "my-tool.json"))).toBe(true);
    expect(await readFile(join(custom, "index.js"), "utf-8")).toBe(
      "export async function execute() { return 'x'; }\n"
    );
  });

  it("handles a missing seed folder gracefully (skips that builtin)", async () => {
    // Point the seed root at a temp dir with a PARTIAL builtin-tools tree:
    // only "read" present, all other builtins missing.
    const fakeSeeds = join(testDir, "fake-seeds", seedSubdirForMode("dev"));
    await mkdir(join(fakeSeeds, "builtin-tools", "read"), { recursive: true });
    await writeFile(
      join(fakeSeeds, "builtin-tools", "read", "read.json"),
      JSON.stringify({
        name: "read",
        description: "Fake read",
        entry: "index.ts",
        inputSchema: { type: "object", properties: {} },
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(
      join(fakeSeeds, "builtin-tools", "read", "index.ts"),
      "export async function execute() { return 'fake'; }\n"
    );
    setSeedRootForTest(join(testDir, "fake-seeds"));

    // No throw: missing seed folders for every other builtin are skipped.
    const cloned = await seedBuiltinToolFolders(dataDir, "dev");

    expect(cloned).toBe(1);
    expect(existsSync(join(dataDir, "tools", "builtin", "read"))).toBe(true);
    expect(existsSync(join(dataDir, "tools", "builtin", "bash"))).toBe(false);
  });

  it("returns 0 when the seed root resolves to null (compiled binary)", async () => {
    setSeedRootForTest(null);
    const cloned = await seedBuiltinToolFolders(dataDir, "packageAndProd");
    expect(cloned).toBe(0);
    expect(existsSync(join(dataDir, "tools", "builtin"))).toBe(false);
  });

  it("seeds both dev and packageAndProd trees", async () => {
    const realSeedRoot = seedsDir()!;
    for (const mode of ["dev", "packageAndProd"]) {
      const seedDir = join(realSeedRoot, seedSubdirForMode(mode), "builtin-tools", "task");
      expect(existsSync(join(seedDir, "task.json"))).toBe(true);
      expect(existsSync(join(seedDir, "index.ts"))).toBe(true);
      expect(existsSync(join(seedDir, "skill.md"))).toBe(true);
      expect(existsSync(join(seedDir, "prompt.json"))).toBe(true);
    }
  });

  it("clones skill.md and prompt.json for guide-bearing tools", async () => {
    const cloned = await seedBuiltinToolFolders(dataDir, "dev");
    expect(cloned).toBe(BUILTIN_TOOL_NAMES.length);

    for (const name of ["todo", "audit"]) {
      const dir = join(dataDir, "tools", "builtin", name);
      expect(existsSync(join(dir, `${name}.json`))).toBe(true);
      expect(existsSync(join(dir, "index.ts"))).toBe(true);
      expect(existsSync(join(dir, "skill.md"))).toBe(true);
      expect(existsSync(join(dir, "prompt.json"))).toBe(true);
    }
  });

  it("recovers from a partial clone: failed copy leaves no folder, next seed clones it", async () => {
    // Fake seed tree containing ONLY "todo", so the returned count is easy to
    // reason about. The seed has several files; make the copy fail on one of
    // them (skill.md) so a clone starts partway before dying.
    const fakeSeeds = join(testDir, "fake-seeds", seedSubdirForMode("dev"));
    const seedTodo = join(fakeSeeds, "builtin-tools", "todo");
    await mkdir(seedTodo, { recursive: true });
    await writeFile(
      join(seedTodo, "todo.json"),
      JSON.stringify({
        name: "todo",
        description: "Fake todo",
        entry: "index.ts",
        inputSchema: { type: "object", properties: {} },
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(join(seedTodo, "index.ts"), "export async function execute() {}\n");
    await writeFile(join(seedTodo, "skill.md"), "# fake todo skill\n");
    await writeFile(
      join(seedTodo, "prompt.json"),
      JSON.stringify({ prompt: "fake todo prompt" })
    );
    setSeedRootForTest(join(testDir, "fake-seeds"));
    setCopyFailureForTest("skill.md");

    // First run: the copy fails partway. It is non-fatal (no throw) and the
    // failed tool is not counted as cloned.
    const first = await seedBuiltinToolFolders(dataDir, "dev");
    expect(first).toBe(0);
    // No partial folder is left behind for the next boot to trust.
    expect(existsSync(join(dataDir, "tools", "builtin", "todo"))).toBe(false);

    // Second run (failure gone): the folder clones cleanly.
    setCopyFailureForTest(undefined);
    const second = await seedBuiltinToolFolders(dataDir, "dev");
    expect(second).toBe(1);
    const clonedDir = join(dataDir, "tools", "builtin", "todo");
    expect(existsSync(join(clonedDir, "todo.json"))).toBe(true);
    expect(existsSync(join(clonedDir, "index.ts"))).toBe(true);
    expect(existsSync(join(clonedDir, "skill.md"))).toBe(true);
    expect(existsSync(join(clonedDir, "prompt.json"))).toBe(true);
  });
});
