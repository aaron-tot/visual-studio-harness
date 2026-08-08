import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBuiltinToolFolders } from "./folder-seed";
import { loadToolsFromFolders } from "./folder-store";
import type { BaseToolContext } from "./types";

/**
 * Per-tool settings now live in each tool's own `<name>.json` and are injected
 * into the entry ctx by `folderToToolDef` — NOT read from config.json. These
 * tests prove the seeded defaults flow through, that custom values are honored
 * (folder read, not hardcoded), and that the per-tool `subagent` /
 * `externalAccess` / `searchProviders` fields are injected too.
 */

function fakeBaseCtx(
  dataDir: string,
  workspaceRoot: string,
  extra?: Partial<BaseToolContext>
): BaseToolContext {
  return {
    sessionId: "sess-per-tool-1",
    turnId: 1,
    workspaceRoot,
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-per-tool-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
    ...extra,
  };
}

/** Replace a seeded tool's entry with a probe that echoes the injected ctx fields. */
async function stubEntryToEchoCtx(dataDir: string, toolName: string): Promise<void> {
  const dir = join(dataDir, "tools", "builtin", toolName);
  await writeFile(
    join(dir, "index.ts"),
    `export async function execute(args: any, ctx: any) {
  return {
    output: JSON.stringify({
      toolSettings: ctx.toolSettings ?? null,
      externalAccess: ctx.externalAccess ?? null,
      searchProviders: ctx.searchProviders ?? null,
      subagent: ctx.subagent ?? null,
    }),
  };
}
`
  );
}

describe("per-tool settings (from the tool's own <name>.json)", () => {
  let testDir: string;
  let dataDir: string;
  let ws: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-per-tool-settings-test-"));
    dataDir = join(testDir, "data");
    ws = join(testDir, "ws");
    await mkdir(ws, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("seeds the bash folder with timeouts and injects them into ctx.toolSettings.bash (not config.json)", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");

    // The seeded data copy of bash.json carries the per-tool timeouts.
    const seeded = JSON.parse(
      await readFile(join(dataDir, "tools", "builtin", "bash", "bash.json"), "utf-8")
    ) as { timeouts?: Record<string, number> };
    expect(seeded.timeouts).toEqual({ minMs: 100, maxMs: 300_000, defaultMs: 30_000 });

    await stubEntryToEchoCtx(dataDir, "bash");
    const defs = await loadToolsFromFolders(dataDir);
    const bash = defs.find((d) => d.name === "bash")!;
    expect(bash).toBeDefined();

    // A conflicting config.json-style toolSettings must NOT win — the folder
    // settings are authoritative.
    const result = await bash.execute(
      {},
      fakeBaseCtx(dataDir, ws, {
        toolSettings: { bash: { timeoutMinMs: 999, timeoutMaxMs: 999_999, timeoutDefaultMs: 99_999 } },
      })
    );
    const parsed = JSON.parse(result.output) as {
      toolSettings?: { bash?: { timeoutMinMs: number; timeoutMaxMs: number; timeoutDefaultMs: number } };
    };
    expect(parsed.toolSettings?.bash).toEqual({
      timeoutMinMs: 100,
      timeoutMaxMs: 300_000,
      timeoutDefaultMs: 30_000,
    });
  });

  it("injects seeded searchOnline timeouts into ctx.toolSettings.webFetch and seeds searchProviders", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");

    const seeded = JSON.parse(
      await readFile(join(dataDir, "tools", "builtin", "searchOnline", "searchOnline.json"), "utf-8")
    ) as {
      timeouts?: Record<string, number>;
      searchProviders?: Array<{ id: string }>;
    };
    expect(seeded.timeouts).toEqual({ minSec: 1, maxSec: 120, defaultSec: 30 });
    expect(seeded.searchProviders?.map((p) => p.id)).toEqual(["exa-primary", "parallel-backup"]);

    await stubEntryToEchoCtx(dataDir, "searchOnline");
    const defs = await loadToolsFromFolders(dataDir);
    const searchOnline = defs.find((d) => d.name === "searchOnline")!;
    const result = await searchOnline.execute({}, fakeBaseCtx(dataDir, ws));
    const parsed = JSON.parse(result.output) as {
      toolSettings?: { webFetch?: { timeoutMinSec: number; timeoutMaxSec: number; timeoutDefaultSec: number } };
      searchProviders?: Array<{ id: string }>;
    };
    expect(parsed.toolSettings?.webFetch).toEqual({
      timeoutMinSec: 1,
      timeoutMaxSec: 120,
      timeoutDefaultSec: 30,
    });
    expect(parsed.searchProviders?.map((p) => p.id)).toEqual(["exa-primary", "parallel-backup"]);
  });

  it("honors custom timeouts edited into a tool's <name>.json (folder read, not hardcoded)", async () => {
    await seedBuiltinToolFolders(dataDir, "dev");

    // Edit the temp data copy of bash.json to different values.
    const bashJsonPath = join(dataDir, "tools", "builtin", "bash", "bash.json");
    const seededBash = JSON.parse(await readFile(bashJsonPath, "utf-8")) as Record<string, unknown>;
    seededBash.timeouts = { minMs: 123, maxMs: 456_000, defaultMs: 7_890 };
    await writeFile(bashJsonPath, JSON.stringify(seededBash, null, 2));

    await stubEntryToEchoCtx(dataDir, "bash");
    const defs = await loadToolsFromFolders(dataDir);
    const bash = defs.find((d) => d.name === "bash")!;
    const result = await bash.execute({}, fakeBaseCtx(dataDir, ws));
    const parsed = JSON.parse(result.output) as {
      toolSettings?: { bash?: { timeoutMinMs: number; timeoutMaxMs: number; timeoutDefaultMs: number } };
    };
    expect(parsed.toolSettings?.bash).toEqual({
      timeoutMinMs: 123,
      timeoutMaxMs: 456_000,
      timeoutDefaultMs: 7_890,
    });
  });

  it("injects subagent / externalAccess / searchProviders from a tool's own config", async () => {
    // Custom tool folder (goes through the same folderToToolDef injection).
    const dir = join(dataDir, "tools", "custom", "probe");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "probe.json"),
      JSON.stringify({
        name: "probe",
        description: "Probe tool",
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
        externalAccess: true,
        subagent: { slotBusyPolicy: "wait", pollIntervalSec: 7, waitTimeoutSec: 60 },
        searchProviders: [
          { id: "probe-provider", type: "exa", name: "Probe", enabled: true, priority: 0 },
        ],
      })
    );
    await writeFile(
      join(dir, "index.js"),
      `export async function execute(args, ctx) {
  return {
    output: JSON.stringify({
      toolSettings: ctx.toolSettings ?? null,
      externalAccess: ctx.externalAccess ?? null,
      searchProviders: ctx.searchProviders ?? null,
      subagent: ctx.subagent ?? null,
    }),
  };
}
`
    );

    const defs = await loadToolsFromFolders(dataDir);
    const probe = defs.find((d) => d.name === "probe")!;
    const result = await probe.execute({}, fakeBaseCtx(dataDir, ws));
    const parsed = JSON.parse(result.output) as {
      externalAccess: boolean | null;
      searchProviders: Array<{ id: string }> | null;
      subagent: { slotBusyPolicy: string; pollIntervalSec: number; waitTimeoutSec: number } | null;
    };
    expect(parsed.externalAccess).toBe(true);
    expect(parsed.searchProviders?.map((p) => p.id)).toEqual(["probe-provider"]);
    expect(parsed.subagent).toEqual({ slotBusyPolicy: "wait", pollIntervalSec: 7, waitTimeoutSec: 60 });
  });
});
