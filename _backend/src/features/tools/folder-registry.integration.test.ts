import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBuiltinToolFolders } from "./folder-seed";
import { createFolderRegistry } from "./index";
import type { BaseToolContext } from "./types";

function fakeBaseCtx(
  dataDir: string,
  workspaceRoot: string,
  extra?: Partial<BaseToolContext>
): BaseToolContext {
  return {
    sessionId: "sess-registry-1",
    turnId: 1,
    workspaceRoot,
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-registry-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
    ...extra,
  };
}

describe("folder registry (what run-turn now uses)", () => {
  let testDir: string;
  let dataDir: string;
  let ws: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-folder-registry-test-"));
    dataDir = join(testDir, "data");
    ws = join(testDir, "ws");
    await mkdir(ws, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("builds a registry from seeded data folders with callable execute", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");
    const registry = await createFolderRegistry(dataDir);

    const names = registry.list().map((d) => d.name);
    for (const n of [
      "read",
      "write",
      "edit",
      "apply_patch",
      "list",
      "bash",
      "searchLocal",
      "skill",
      "customTool",
      "agent_change",
      "searchOnline",
      "todo",
      "design",
      "notes",
      "audit",
      "graph",
      "knowledge",
    ]) {
      expect(names).toContain(n);
    }

    const ctx = fakeBaseCtx(dataDir, ws);
    const write = registry.get("write")!;
    const read = registry.get("read")!;
    await write.execute({ path: "r.txt", content: "hello\n" }, ctx);
    const r = await read.execute({ path: "r.txt" }, ctx);
    expect(r.output).toContain("hello");
  });

  it("excludes task when exclude:['task'] and serves makeTaskTool otherwise", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");

    const excluded = await createFolderRegistry(dataDir, { exclude: ["task"] });
    expect(excluded.get("task")).toBeUndefined();
    expect(excluded.list().some((d) => d.name === "task")).toBe(false);

    const full = await createFolderRegistry(dataDir);
    const task = full.get("task");
    expect(task).toBeDefined();
    // makeTaskTool's description appends the available agent configs list; the
    // raw folder task entry's description does not — proves task is served by
    // the compiled makeTaskTool (real subagent dispatch) in the folder registry.
    expect(task!.description).toContain("Available agent configs");
  });

  it("threads ctx.skillRoots through to the folder skill entry", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");
    const registry = await createFolderRegistry(dataDir);
    const skill = registry.get("skill")!;

    const customRoot = join(testDir, "my-roots", "_skills");
    await mkdir(join(customRoot, "probe-skill"), { recursive: true });
    await writeFile(join(customRoot, "probe-skill", "SKILL.md"), "# Probe\n\ncontent\n");

    const ctx = fakeBaseCtx(dataDir, ws, { skillRoots: [customRoot] });
    const list = await skill.execute({ mode: "list" }, ctx);
    expect(list.isError).toBeFalsy();
    expect(list.output).toContain("probe-skill");

    const read = await skill.execute({ name: "probe-skill" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("# Probe");
  });
});
