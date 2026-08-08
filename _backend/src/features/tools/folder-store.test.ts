import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listToolFolders,
  loadToolEntry,
  loadToolsFromFolders,
  normalizeToolResult,
} from "./folder-store";
import { createFolderRegistry } from "./index";
import type { BaseToolContext } from "./types";

const PROBE_CONFIG = {
  name: "probe",
  description: "Probe tool",
  entry: "index.js",
  inputSchema: {
    type: "object",
    properties: { msg: { type: "string" } },
  },
  enabled: true,
  permissionDefault: "ask",
};

const READ_CONFIG = {
  name: "read",
  description: "Read tool stub",
  entry: "index.ts",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
  },
  enabled: true,
  permissionDefault: "ask",
};

function fakeBaseCtx(dataDir: string): BaseToolContext {
  return {
    sessionId: "sess-1",
    turnId: 1,
    workspaceRoot: join(dataDir, "..", "ws"),
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
  };
}

/** Scaffold a custom tool folder with the given entry content. */
async function writeToolFolder(
  dataDir: string,
  name: string,
  entryContent: string,
  configOverrides: Record<string, unknown> = {}
): Promise<void> {
  const dir = join(dataDir, "tools", "custom", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.json`),
    JSON.stringify(
      {
        name,
        description: `${name} tool`,
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
        ...configOverrides,
      },
      null,
      2
    )
  );
  await writeFile(join(dir, "index.js"), entryContent);
}

describe("folder store", () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-folder-store-test-"));
    dataDir = join(testDir, "data");

    const customProbe = join(dataDir, "tools", "custom", "probe");
    await mkdir(customProbe, { recursive: true });
    await writeFile(
      join(customProbe, "probe.json"),
      JSON.stringify(PROBE_CONFIG, null, 2)
    );
    await writeFile(
      join(customProbe, "index.js"),
      `export async function execute(args, ctx) {
  return { output: "echo:" + args.msg + "|" + (ctx.workspaceRoot ? "hasCtx" : "noCtx") };
}
`
    );

    const builtinRead = join(dataDir, "tools", "builtin", "read");
    await mkdir(builtinRead, { recursive: true });
    await writeFile(
      join(builtinRead, "read.json"),
      JSON.stringify(READ_CONFIG, null, 2)
    );
    await writeFile(
      join(builtinRead, "index.ts"),
      `export async function execute(args: { path?: string }, ctx: { workspaceRoot?: string }): Promise<unknown> {
  return { output: "read:" + (args.path ?? "") + "|" + (ctx.workspaceRoot ? "hasCtx" : "noCtx") };
}
`
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("lists builtin and custom tool folders with config + entryPath", async () => {
    const folders = await listToolFolders(dataDir);

    expect(folders).toHaveLength(2);
    const probe = folders.find((f) => f.name === "probe");
    const read = folders.find((f) => f.name === "read");

    expect(probe).toBeDefined();
    expect(probe!.kind).toBe("custom");
    expect(probe!.config).toEqual(PROBE_CONFIG);
    expect(probe!.entryPath).toBe(join(dataDir, "tools", "custom", "probe", "index.js"));

    expect(read).toBeDefined();
    expect(read!.kind).toBe("builtin");
    expect(read!.entryPath).toBe(join(dataDir, "tools", "builtin", "read", "index.ts"));
  });

  it("returns an empty array when data/tools does not exist", async () => {
    const missing = join(testDir, "does-not-exist");
    const folders = await listToolFolders(missing);
    expect(folders).toEqual([]);
  });

  it("skips folders without a readable <name>.json", async () => {
    const orphan = join(dataDir, "tools", "custom", "orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "index.js"), "export async function execute() { return 'x'; }\n");

    const folders = await listToolFolders(dataDir);
    expect(folders.find((f) => f.name === "orphan")).toBeUndefined();
  });

  it("loads the custom entry and executes it with args + ctx", async () => {
    const folders = await listToolFolders(dataDir);
    const probe = folders.find((f) => f.name === "probe")!;

    const entry = await loadToolEntry(probe);
    const result = await entry.execute(
      { msg: "hello" },
      { workspaceRoot: "/fake/ws" }
    );

    expect(result).toEqual({ output: "echo:hello|hasCtx" });
  });

  it("loads an entry that default-exports its execute function", async () => {
    await writeToolFolder(
      dataDir,
      "defaults",
      `export default async function execute(args, ctx) {
  return { output: "default:" + args.msg };
}
`
    );

    const folders = await listToolFolders(dataDir);
    const entry = await loadToolEntry(folders.find((f) => f.name === "defaults")!);
    const result = await entry.execute({ msg: "hi" }, { workspaceRoot: "/fake/ws" });

    expect(result).toEqual({ output: "default:hi" });
  });

  it("loads an entry that exports { tool: { execute } }", async () => {
    await writeToolFolder(
      dataDir,
      "wrapped",
      `export const tool = {
  execute: async function execute(args, ctx) {
    return { output: "wrapped:" + args.msg };
  },
};
`
    );

    const folders = await listToolFolders(dataDir);
    const entry = await loadToolEntry(folders.find((f) => f.name === "wrapped")!);
    const result = await entry.execute({ msg: "yo" }, { workspaceRoot: "/fake/ws" });

    expect(result).toEqual({ output: "wrapped:yo" });
  });

  it("throws when an entry exports no execute function", async () => {
    await writeToolFolder(dataDir, "bogus", "export const nope = 42;\n");

    const folders = await listToolFolders(dataDir);
    const bogus = folders.find((f) => f.name === "bogus")!;

    await expect(loadToolEntry(bogus)).rejects.toThrow(
      /does not export an `execute` function/
    );
  });

  it("builds ToolDefs and passes the harness ctx into the tool", async () => {
    const defs = await loadToolsFromFolders(dataDir);
    const probeDef = defs.find((d) => d.name === "probe")!;
    const readDef = defs.find((d) => d.name === "read")!;

    expect(defs).toHaveLength(2);
    expect(probeDef.permissionDefault).toBe("ask");
    expect(readDef.permissionDefault).toBe("ask");

    const result = await probeDef.execute(
      { msg: "hello" },
      fakeBaseCtx(dataDir)
    );

    expect(result).toEqual({ title: "probe", output: "echo:hello|hasCtx" });

    const readResult = await readDef.execute(
      { path: "a.txt" },
      fakeBaseCtx(dataDir)
    );
    expect(readResult).toEqual({ title: "read", output: "read:a.txt|hasCtx" });
  });

  it("excludes disabled tools from the ToolDef list", async () => {
    const disabled = join(dataDir, "tools", "custom", "off");
    await mkdir(disabled, { recursive: true });
    await writeFile(
      join(disabled, "off.json"),
      JSON.stringify({
        name: "off",
        description: "Disabled tool",
        entry: "index.js",
        inputSchema: {},
        enabled: false,
        permissionDefault: "ask",
      })
    );
    await writeFile(
      join(disabled, "index.js"),
      "export async function execute() { return 'should not run'; }\n"
    );

    const defs = await loadToolsFromFolders(dataDir);
    expect(defs.find((d) => d.name === "off")).toBeUndefined();
  });

  it("normalizes string and error results from a tool entry", async () => {
    const mixed = join(dataDir, "tools", "custom", "mixed");
    await mkdir(mixed, { recursive: true });
    await writeFile(
      join(mixed, "mixed.json"),
      JSON.stringify({
        name: "mixed",
        description: "Mixed results tool",
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(
      join(mixed, "index.js"),
      `export async function execute(args, ctx) {
  if (args.kind === "string") return "plain string";
  if (args.kind === "err") return { output: "boom", isError: true };
  throw new Error("kaboom");
}
`
    );

    const defs = await loadToolsFromFolders(dataDir);
    const mixedDef = defs.find((d) => d.name === "mixed")!;
    const baseCtx = fakeBaseCtx(dataDir);

    const stringResult = await mixedDef.execute({ kind: "string" }, baseCtx);
    expect(stringResult).toEqual({ title: "mixed", output: "plain string" });

    const errResult = await mixedDef.execute({ kind: "err" }, baseCtx);
    expect(errResult).toEqual({
      title: "mixed",
      output: "boom",
      isError: true,
    });

    const thrownResult = await mixedDef.execute({ kind: "throw" }, baseCtx);
    expect(thrownResult.isError).toBe(true);
    expect(thrownResult.output).toContain("kaboom");
  });

  it("passes _stopTurn and metadata through object results", () => {
    const result = normalizeToolResult("probe", {
      output: "done",
      _stopTurn: true,
      metadata: { reason: "complete", attempts: 2 },
    });

    expect(result).toEqual({
      title: "probe",
      output: "done",
      _stopTurn: true,
      metadata: { reason: "complete", attempts: 2 },
    });
  });

  it("normalizes non-string, non-object results via String()", () => {
    expect(normalizeToolResult("num", 42)).toEqual({ title: "num", output: "42" });
    expect(normalizeToolResult("nil", null)).toEqual({ title: "nil", output: "" });
    expect(normalizeToolResult("undef", undefined)).toEqual({
      title: "undef",
      output: "",
    });
  });

  it("builds a registry from the data folders via createFolderRegistry", async () => {
    const registry = await createFolderRegistry(dataDir);
    const names = registry.list().map((d) => d.name).sort();

    expect(names).toEqual(["probe", "read"]);
    const probeDef = registry.get("probe")!;
    const result = await probeDef.execute({ msg: "hi" }, fakeBaseCtx(dataDir));
    expect(result).toEqual({ title: "probe", output: "echo:hi|hasCtx" });
  });

  it("applies exclude and extraTools in createFolderRegistry", async () => {
    const extra = {
      name: "extra",
      description: "Extra tool",
      inputSchema: { type: "object", properties: {} } as never,
      permissionDefault: "allow" as const,
      execute: async () => ({ title: "extra", output: "ok" }),
    };
    const registry = await createFolderRegistry(dataDir, {
      exclude: ["probe"],
      extraTools: [extra],
    });

    expect(registry.get("probe")).toBeUndefined();
    expect(registry.get("extra")).toBeDefined();
    expect(registry.get("read")).toBeDefined();
  });

  it("resolves a ctx with sandbox and formatting helpers", async () => {
    // Verify the ctx surface directly via a dedicated probe tool that
    // JSON-serializes what it received.
    const surfaceProbe = join(dataDir, "tools", "custom", "surface");
    await mkdir(surfaceProbe, { recursive: true });
    await writeFile(
      join(surfaceProbe, "surface.json"),
      JSON.stringify({
        name: "surface",
        description: "Surface probe",
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(
      join(surfaceProbe, "index.js"),
      `export async function execute(args, ctx) {
  return {
    output: JSON.stringify({
      hasSandboxError: typeof ctx.SandboxError === "function",
      hasClassifyPath: typeof ctx.classifyPath === "function",
      hasResolveAccessiblePath: typeof ctx.resolveAccessiblePath === "function",
      hasFormatNumberedLines: typeof ctx.formatNumberedLines === "function",
      hasTruncateText: typeof ctx.truncateText === "function",
      hasAskPermission: typeof ctx.askPermission === "function",
      hasAbortSignal: !!ctx.abortSignal,
      hasGraphService: "graphService" in ctx,
      hasAgentSettings: "agentSettings" in ctx,
      hasToolSettings: "toolSettings" in ctx,
      toolName: ctx.toolName,
      callId: ctx.callId,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
    }),
  };
}
`
    );

    const surfaceDefs = await loadToolsFromFolders(dataDir);
    const surfaceDef = surfaceDefs.find((d) => d.name === "surface")!;
    const result = await surfaceDef.execute({}, fakeBaseCtx(dataDir));
    const parsed = JSON.parse(result.output) as Record<string, unknown>;

    expect(parsed.hasSandboxError).toBe(true);
    expect(parsed.hasClassifyPath).toBe(true);
    expect(parsed.hasResolveAccessiblePath).toBe(true);
    expect(parsed.hasFormatNumberedLines).toBe(true);
    expect(parsed.hasTruncateText).toBe(true);
    expect(parsed.hasAskPermission).toBe(true);
    expect(parsed.hasAbortSignal).toBe(true);
    expect(parsed.hasGraphService).toBe(true);
    expect(parsed.hasAgentSettings).toBe(true);
    expect(parsed.hasToolSettings).toBe(true);
    expect(parsed.toolName).toBe("surface");
    expect(parsed.callId).toBe("call-1");
    expect(parsed.sessionId).toBe("sess-1");
    expect(parsed.turnId).toBe(1);
  });
});
