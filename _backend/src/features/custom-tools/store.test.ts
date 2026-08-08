import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  writeCustomTool,
  readCustomTool,
  deleteCustomTool,
  listCustomTools,
  loadCustomToolDefs,
  migrateLegacyCustomTools,
  codeToEntryModule,
  __setWriteCustomToolFailureHook,
} from "./store";
import type { BaseToolContext } from "../tools/types";

function fakeBaseCtx(dataDir: string, workspaceRoot: string): BaseToolContext {
  return {
    sessionId: "sess-ct-1",
    turnId: 1,
    workspaceRoot,
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-ct-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
  };
}

describe("custom-tools folder store (unified folder-per-tool shape)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-ct-folder-store-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("writes a tool to data/tools/custom/<name>/ as ToolConfig + index.js + skill files", async () => {
    await writeCustomTool(testDir, {
      name: "hello",
      description: "Says hi",
      inputSchema: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
      code: "return `hi ${args.who}`;",
      enabled: true,
      permissionDefault: "allow",
      skillGuide: "# Hello Guide",
      skillPushMode: "hard",
      skillId: "hello",
      skillTags: ["greeting", "demo"],
    });

    const dir = join(testDir, "tools", "custom", "hello");
    expect(existsSync(dir)).toBe(true);

    const cfg = JSON.parse(await readFile(join(dir, "hello.json"), "utf-8"));
    expect(cfg.name).toBe("hello");
    expect(cfg.entry).toBe("index.js");
    expect(cfg.enabled).toBe(true);
    expect(cfg.permissionDefault).toBe("allow");
    expect(cfg.skill?.guide).toBe("# Hello Guide");
    expect(cfg.skill?.pushMode).toBe("hard");
    expect(cfg.skill?.id).toBe("hello");
    expect(cfg.skill?.tags).toEqual(["greeting", "demo"]);

    // index.js is the entry file carrying the tool's code (wrapped into a module).
    const entry = await readFile(join(dir, "index.js"), "utf-8");
    expect(entry).toBe(codeToEntryModule("return `hi ${args.who}`;"));
    expect(entry).toContain("return `hi ${args.who}`;");

    expect(await readFile(join(dir, "skill.md"), "utf-8")).toBe("# Hello Guide");
    const prompt = JSON.parse(await readFile(join(dir, "prompt.json"), "utf-8"));
    expect(prompt.tags).toEqual(["greeting", "demo"]);
  });

  it("list/read roundtrip returns CustomTool-shaped records incl. code from the entry", async () => {
    await writeCustomTool(testDir, {
      name: "tool-a",
      description: "Tool A",
      inputSchema: { type: "object", properties: {} },
      code: "return 'a';",
      enabled: true,
    });
    await writeCustomTool(testDir, {
      name: "tool-b",
      description: "Tool B",
      inputSchema: { type: "object", properties: {} },
      code: "return 'b';",
      enabled: false,
    });

    const tools = await listCustomTools(testDir);
    expect(tools.map((t) => t.name)).toEqual(["tool-a", "tool-b"]);

    const a = await readCustomTool(testDir, "tool-a");
    expect(a?.description).toBe("Tool A");
    expect(a?.enabled).toBe(true);
    expect(a?.code).toBe(codeToEntryModule("return 'a';"));

    const b = await readCustomTool(testDir, "tool-b");
    expect(b?.enabled).toBe(false);
    expect(b?.code).toBe(codeToEntryModule("return 'b';"));
  });

  it("read returns null for a missing tool", async () => {
    expect(await readCustomTool(testDir, "nope")).toBeNull();
    expect(await listCustomTools(testDir)).toEqual([]);
  });

  it("delete removes the whole folder", async () => {
    await writeCustomTool(testDir, {
      name: "del",
      description: "D",
      inputSchema: { type: "object", properties: {} },
      code: "return 'd';",
      enabled: true,
      skillGuide: "# Del Guide",
      skillTags: ["x"],
    });
    expect(existsSync(join(testDir, "tools", "custom", "del"))).toBe(true);

    await deleteCustomTool(testDir, "del");

    expect(existsSync(join(testDir, "tools", "custom", "del"))).toBe(false);
    expect(await readCustomTool(testDir, "del")).toBeNull();
  });

  it("update overwrites the entry and drops a removed skill guide", async () => {
    await writeCustomTool(testDir, {
      name: "upd",
      description: "Before",
      inputSchema: { type: "object", properties: {} },
      code: "return 'before';",
      enabled: true,
      skillGuide: "# Guide",
      skillTags: ["a"],
    });
    await writeCustomTool(testDir, {
      name: "upd",
      description: "After",
      inputSchema: { type: "object", properties: {} },
      code: "return 'after';",
      enabled: true,
    });

    const read = await readCustomTool(testDir, "upd");
    expect(read?.description).toBe("After");
    expect(read?.code).toBe(codeToEntryModule("return 'after';"));
    expect(read?.skillGuide).toBeUndefined();
    expect(existsSync(join(testDir, "tools", "custom", "upd", "skill.md"))).toBe(false);
    expect(existsSync(join(testDir, "tools", "custom", "upd", "prompt.json"))).toBe(false);
  });

  describe("migrateLegacyCustomTools", () => {
    it("converts flat data/custom-tools/*.json into the folder shape and is idempotent", async () => {
      const legacyDir = join(testDir, "custom-tools");
      await mkdir(legacyDir, { recursive: true });

      const legacy = {
        name: "legacy-one",
        description: "Legacy tool",
        inputSchema: { type: "object", properties: { v: { type: "string" } }, required: ["v"] },
        code: "return `Updated: ${args.v}`;",
        enabled: true,
        permissionDefault: "ask",
        skillGuide: "# Legacy Guide",
        skillPushMode: "hard",
        skillId: "legacy-one",
      };
      await writeFile(join(legacyDir, "legacy-one.json"), JSON.stringify(legacy, null, 2));
      await writeFile(join(legacyDir, "legacy-one.skill.md"), "# Legacy Guide");
      await writeFile(join(legacyDir, "legacy-one.prompt.json"), JSON.stringify({ tags: ["legacy"] }, null, 2));

      const migrated = await migrateLegacyCustomTools(testDir);
      expect(migrated).toBe(1);

      const dir = join(testDir, "tools", "custom", "legacy-one");
      expect(existsSync(join(dir, "legacy-one.json"))).toBe(true);
      const cfg = JSON.parse(await readFile(join(dir, "legacy-one.json"), "utf-8"));
      expect(cfg.entry).toBe("index.js");
      expect(cfg.skill?.guide).toBe("# Legacy Guide");
      expect(cfg.skill?.pushMode).toBe("hard");
      expect(cfg.skill?.tags).toEqual(["legacy"]);

      expect(await readFile(join(dir, "index.js"), "utf-8")).toBe(
        codeToEntryModule("return `Updated: ${args.v}`;")
      );
      expect(await readFile(join(dir, "skill.md"), "utf-8")).toBe("# Legacy Guide");
      expect(JSON.parse(await readFile(join(dir, "prompt.json"), "utf-8")).tags).toEqual(["legacy"]);

      // The legacy flat source is removed only after the folder shape verified.
      expect(existsSync(join(legacyDir, "legacy-one.json"))).toBe(false);
      expect(existsSync(join(legacyDir, "legacy-one.skill.md"))).toBe(false);
      expect(existsSync(join(legacyDir, "legacy-one.prompt.json"))).toBe(false);

      // Idempotent: a second run converts nothing and does not error.
      const again = await migrateLegacyCustomTools(testDir);
      expect(again).toBe(0);
      expect(existsSync(join(dir, "index.js"))).toBe(true);
      expect((await listCustomTools(testDir)).length).toBe(1);
    });

    it("loads a sibling skill.md when the legacy JSON has no inline skillGuide", async () => {
      const legacyDir = join(testDir, "custom-tools");
      await mkdir(legacyDir, { recursive: true });
      await writeFile(
        join(legacyDir, "sibling.json"),
        JSON.stringify({
          name: "sibling",
          description: "S",
          inputSchema: { type: "object", properties: {} },
          code: "return 'ok';",
          enabled: true,
        })
      );
      await writeFile(join(legacyDir, "sibling.skill.md"), "# Sibling Guide");

      const migrated = await migrateLegacyCustomTools(testDir);
      expect(migrated).toBe(1);
      const read = await readCustomTool(testDir, "sibling");
      expect(read?.skillGuide).toBe("# Sibling Guide");
    });

    it("skips tools whose folder already exists in the new shape (idempotent, no clobber)", async () => {
      const legacyDir = join(testDir, "custom-tools");
      await mkdir(legacyDir, { recursive: true });
      await writeFile(
        join(legacyDir, "dup.json"),
        JSON.stringify({ name: "dup", description: "D", inputSchema: {}, code: "return 'old';", enabled: true })
      );

      // Folder already present in the new shape (e.g. from a prior run / manual write).
      await writeCustomTool(testDir, {
        name: "dup",
        description: "D",
        inputSchema: { type: "object", properties: {} },
        code: "return 'new';",
        enabled: true,
      });

      const migrated = await migrateLegacyCustomTools(testDir);
      expect(migrated).toBe(0);
      // The existing folder shape is untouched.
      expect(await readFile(join(testDir, "tools", "custom", "dup", "index.js"), "utf-8")).toBe(
        codeToEntryModule("return 'new';")
      );
      // And the legacy source is left alone (never deleted when skipped).
      expect(existsSync(join(legacyDir, "dup.json"))).toBe(true);
    });

    it("cleans up the partial folder on a mid-write failure so the next run retries", async () => {
      const legacyDir = join(testDir, "custom-tools");
      await mkdir(legacyDir, { recursive: true });
      await writeFile(
        join(legacyDir, "flaky.json"),
        JSON.stringify({
          name: "flaky",
          description: "F",
          inputSchema: { type: "object", properties: {} },
          code: "return 'flaky';",
          enabled: true,
        })
      );

      // Simulate a write that fails partway (after the folder + config are
      // written, before the entry file).
      __setWriteCustomToolFailureHook(() => {
        throw new Error("simulated mid-write failure");
      });
      try {
        const first = await migrateLegacyCustomTools(testDir);
        expect(first).toBe(0);
      } finally {
        __setWriteCustomToolFailureHook(undefined);
      }

      // (a) No partial `data/tools/custom/<name>/` folder remains.
      expect(existsSync(join(testDir, "tools", "custom", "flaky"))).toBe(false);
      // (b) The legacy source is retained.
      expect(existsSync(join(legacyDir, "flaky.json"))).toBe(true);

      // (c) A subsequent run migrates it successfully.
      const second = await migrateLegacyCustomTools(testDir);
      expect(second).toBe(1);
      expect(await readFile(join(testDir, "tools", "custom", "flaky", "index.js"), "utf-8")).toBe(
        codeToEntryModule("return 'flaky';")
      );
      expect(existsSync(join(legacyDir, "flaky.json"))).toBe(false);
    });

    it("skips legacy tools with an unsafe name (path escape) and leaves them for manual handling", async () => {
      const legacyDir = join(testDir, "custom-tools");
      await mkdir(legacyDir, { recursive: true });
      await writeFile(
        join(legacyDir, "escape.json"),
        JSON.stringify({
          name: "../../escape",
          description: "E",
          inputSchema: { type: "object", properties: {} },
          code: "return 'escape';",
          enabled: true,
        })
      );

      const migrated = await migrateLegacyCustomTools(testDir);
      expect(migrated).toBe(0);
      // Nothing escaped the custom-tools directory.
      expect(existsSync(join(testDir, "tools", "custom", "..", "..", "escape"))).toBe(false);
      expect(existsSync(join(testDir, "escape"))).toBe(false);
      // The unsafe legacy source is kept for manual handling.
      expect(existsSync(join(legacyDir, "escape.json"))).toBe(true);
    });
  });

  it("loadCustomToolDefs returns an executable ToolDef for a migrated tool", async () => {
    const legacyDir = join(testDir, "custom-tools");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "echo.json"),
      JSON.stringify({
        name: "echo",
        description: "Echo msg",
        inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
        code: "return `echo: ${args.msg}`;",
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await migrateLegacyCustomTools(testDir);

    const defs = await loadCustomToolDefs(testDir);
    const echo = defs.find((d) => d.name === "echo");
    expect(echo).toBeDefined();

    const ctx = fakeBaseCtx(testDir, join(testDir, "ws"));
    const result = await echo!.execute({ msg: "hello" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.output).toBe("echo: hello");
  });

  it("loadCustomToolDefs excludes disabled tools", async () => {
    await writeCustomTool(testDir, {
      name: "on",
      description: "On",
      inputSchema: { type: "object", properties: {} },
      code: "return 'on';",
      enabled: true,
    });
    await writeCustomTool(testDir, {
      name: "off",
      description: "Off",
      inputSchema: { type: "object", properties: {} },
      code: "return 'off';",
      enabled: false,
    });

    const defs = await loadCustomToolDefs(testDir);
    expect(defs.map((d) => d.name).sort()).toEqual(["on"]);
  });
});
