import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readToolConfig, ToolConfigSchema } from "./tool-config";

const VALID_TOOL = {
  name: "demo-tool",
  description: "A demo tool",
  entry: "index.ts",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  enabled: true,
  permissionDefault: "ask",
  timeouts: { minMs: 100, maxMs: 30_000, defaultMs: 5_000 },
  externalAccess: true,
  subagent: { slotBusyPolicy: "wait", pollIntervalSec: 2, waitTimeoutSec: 60 },
  searchProviders: [
    { id: "exa-1", type: "exa", name: "Exa", enabled: true, priority: 1, tags: [] },
  ],
  skill: { guide: "# Guide", pushMode: "hard", id: "demo-tool", tags: ["demo"], customPushText: "Read the guide." },
};

describe("ToolConfigSchema", () => {
  it("parses a valid tool config and round-trips all fields", () => {
    const result = ToolConfigSchema.parse(VALID_TOOL);

    expect(result).toEqual(VALID_TOOL);
    expect(result.name).toBe("demo-tool");
    expect(result.description).toBe("A demo tool");
    expect(result.entry).toBe("index.ts");
    expect(result.enabled).toBe(true);
    expect(result.permissionDefault).toBe("ask");
    expect(result.timeouts).toEqual({ minMs: 100, maxMs: 30_000, defaultMs: 5_000 });
    expect(result.externalAccess).toBe(true);
    expect(result.subagent).toEqual({ slotBusyPolicy: "wait", pollIntervalSec: 2, waitTimeoutSec: 60 });
    expect(result.searchProviders).toEqual(VALID_TOOL.searchProviders);
    expect(result.skill).toEqual(VALID_TOOL.skill);
  });

  it("accepts a minimal config with only required fields", () => {
    const result = ToolConfigSchema.parse({
      name: "minimal",
      description: "Minimal tool",
      entry: "index.js",
      inputSchema: {},
      enabled: false,
      permissionDefault: "deny",
    });

    expect(result.name).toBe("minimal");
    expect(result.enabled).toBe(false);
    expect(result.permissionDefault).toBe("deny");
    expect(result.timeouts).toBeUndefined();
    expect(result.skill).toBeUndefined();
  });

  it("throws when a required field is missing", () => {
    const { name: _name, ...withoutName } = VALID_TOOL;
    expect(() => ToolConfigSchema.parse(withoutName)).toThrow();

    const { description: _description, ...withoutDescription } = VALID_TOOL;
    expect(() => ToolConfigSchema.parse(withoutDescription)).toThrow();
  });

  it("throws when permissionDefault is invalid", () => {
    expect(() =>
      ToolConfigSchema.parse({ ...VALID_TOOL, permissionDefault: "always" }),
    ).toThrow();
  });
});

describe("readToolConfig", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-tool-config-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("reads and validates a sample <name>.json from disk", async () => {
    const jsonPath = join(testDir, "demo-tool.json");
    await writeFile(jsonPath, JSON.stringify(VALID_TOOL, null, 2));

    const result = await readToolConfig(jsonPath);

    expect(result).toEqual(VALID_TOOL);
    expect(result.name).toBe("demo-tool");
    expect(result.permissionDefault).toBe("ask");
  });

  it("throws when the file is missing", async () => {
    await expect(readToolConfig(join(testDir, "missing.json"))).rejects.toThrow();
  });

  it("throws when the file contains an invalid config", async () => {
    const jsonPath = join(testDir, "bad.json");
    await writeFile(jsonPath, JSON.stringify({ ...VALID_TOOL, permissionDefault: "nope" }));

    await expect(readToolConfig(jsonPath)).rejects.toThrow();
  });
});
