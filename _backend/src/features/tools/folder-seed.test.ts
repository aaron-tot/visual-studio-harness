import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  seedBuiltinToolFolders,
  setSeedRootForTest,
  setCopyFailureForTest,
  setEmbeddedSeedsForTest,
} from "./folder-seed";
import { BUILTIN_TOOL_NAMES, createFolderRegistry } from "./index";
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
    setEmbeddedSeedsForTest(undefined);
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

  it("createFolderRegistry falls back to compiled builtins when data/tools/builtin/ is absent", async () => {
    // Fresh data dir with NO builtin tool folders (compiled-binary shape): the
    // registry must still expose the full compiled native tool set.
    const registry = await createFolderRegistry(dataDir);

    const names = registry.list().map((d) => d.name);
    for (const n of [
      "read",
      "write",
      "edit",
      "apply_patch",
      "bash",
      "skill",
      "customTool",
      "agent_change",
      "searchLocal",
      "searchOnline",
      "todo",
      "design",
      "notes",
      "audit",
      "graph",
      "knowledge",
      "list",
      "task",
    ]) {
      expect(names).toContain(n);
    }
    // task is served by the compiled makeTaskTool (real subagent dispatch).
    expect(registry.get("task")!.description).toContain("Available agent configs");
  });

  it("createFolderRegistry keeps folder custom tools when falling back to compiled builtins", async () => {
    // A custom tool folder exists even though no builtin folders do.
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
    await writeFile(
      join(custom, "index.js"),
      "export async function execute() { return 'x'; }\n"
    );

    const registry = await createFolderRegistry(dataDir);

    // Folder custom tools are still registered...
    expect(registry.get("my-tool")).toBeDefined();
    expect(registry.list().some((d) => d.name === "my-tool")).toBe(true);
    // ...alongside the compiled builtin fallback.
    expect(registry.get("read")).toBeDefined();
    expect(registry.get("bash")).toBeDefined();
  });

  it("extracts builtin tool folders from the embedded seed map when the seed root is null", async () => {
    setSeedRootForTest(null); // compiled binary: no repo seeds on disk
    setEmbeddedSeedsForTest({
      "read/read.json": Buffer.from(
        JSON.stringify({
          name: "read",
          description: "Embedded read",
          entry: "index.ts",
          inputSchema: { type: "object", properties: {} },
          enabled: true,
          permissionDefault: "allow",
        })
      ).toString("base64"),
      "read/index.ts": Buffer.from(
        "export async function execute() { return 'embedded'; }\n"
      ).toString("base64"),
      "bash/bash.json": Buffer.from(
        JSON.stringify({
          name: "bash",
          description: "Embedded bash",
          entry: "index.ts",
          inputSchema: { type: "object", properties: {} },
          enabled: true,
          permissionDefault: "allow",
        })
      ).toString("base64"),
      "bash/index.ts": Buffer.from(
        "export async function execute() { return 'embedded'; }\n"
      ).toString("base64"),
    });

    const cloned = await seedBuiltinToolFolders(dataDir, "packageAndProd");

    expect(cloned).toBe(2);
    expect(existsSync(join(dataDir, "tools", "builtin", "read", "read.json"))).toBe(true);
    expect(existsSync(join(dataDir, "tools", "builtin", "read", "index.ts"))).toBe(true);
    expect(existsSync(join(dataDir, "tools", "builtin", "bash", "bash.json"))).toBe(true);
    expect(existsSync(join(dataDir, "tools", "builtin", "bash", "index.ts"))).toBe(true);
    // Tools with no embedded files are not cloned.
    expect(existsSync(join(dataDir, "tools", "builtin", "todo"))).toBe(false);

    // Decoded content round-trips.
    const readCfg = JSON.parse(
      await readFile(join(dataDir, "tools", "builtin", "read", "read.json"), "utf-8")
    ) as { description: string };
    expect(readCfg.description).toBe("Embedded read");
    expect(await readFile(join(dataDir, "tools", "builtin", "read", "index.ts"), "utf-8")).toContain(
      "embedded"
    );
  });

  it("embedded-seed extraction never overwrites an existing data folder", async () => {
    setSeedRootForTest(null);
    setEmbeddedSeedsForTest({
      "read/read.json": Buffer.from(
        JSON.stringify({
          name: "read",
          description: "Seed",
          entry: "index.ts",
          inputSchema: { type: "object", properties: {} },
          enabled: true,
          permissionDefault: "allow",
        })
      ).toString("base64"),
      "read/index.ts": Buffer.from("export async function execute() {}\n").toString("base64"),
    });

    // Pre-seed an EDITED data copy (sentinel description) before extracting.
    const target = join(dataDir, "tools", "builtin", "read");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "read.json"), JSON.stringify({ description: "EDITED" }));

    const cloned = await seedBuiltinToolFolders(dataDir, "packageAndProd");

    // The existing folder was NOT extracted (count excludes it) and NOT clobbered.
    expect(cloned).toBe(0);
    const after = JSON.parse(await readFile(join(target, "read.json"), "utf-8")) as {
      description: string;
    };
    expect(after.description).toBe("EDITED");
  });
});
