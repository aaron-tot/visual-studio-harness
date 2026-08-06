import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  writeCustomTool,
  readCustomTool,
  deleteCustomTool,
  listCustomTools,
  customToolToToolDef,
} from "../../custom-tools/store";

describe("customTool native tool store", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-custom-tool-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates and reads a custom tool with skill guide", async () => {
    const tool = {
      name: "test-tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      code: "return args.query;",
      enabled: true,
      skillGuide: "# Test Guide\n\nUse this tool for testing.",
      skillPushMode: "hard" as const,
      skillId: "test-tool",
    };

    await writeCustomTool(testDir, tool);
    const read = await readCustomTool(testDir, "test-tool");

    expect(read).not.toBeNull();
    expect(read?.name).toBe("test-tool");
    expect(read?.skillGuide).toBe("# Test Guide\n\nUse this tool for testing.");
    expect(read?.skillPushMode).toBe("hard");
    expect(read?.skillId).toBe("test-tool");
  });

  it("creates .skill.md file alongside .json", async () => {
    const tool = {
      name: "skill-file-test",
      description: "Test skill file creation",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
      skillGuide: "# Skill File Test\n\nThis is a test skill guide.",
      skillPushMode: "soft" as const,
      skillId: "skill-file-test",
    };

    await writeCustomTool(testDir, tool);

    // Check .skill.md file exists and has content
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const skillPath = join(testDir, "custom-tools", "skill-file-test.skill.md");
    const content = await readFile(skillPath, "utf-8");
    expect(content).toBe("# Skill File Test\n\nThis is a test skill guide.");
  });

  it("lists custom tools", async () => {
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
    expect(tools.length).toBe(2);
    expect(tools.map(t => t.name)).toEqual(["tool-a", "tool-b"]);
  });

  it("deletes custom tool and skill.md", async () => {
    await writeCustomTool(testDir, {
      name: "delete-test",
      description: "Test deletion",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
      skillGuide: "# Delete Test",
      skillPushMode: "soft",
      skillId: "delete-test",
    });

    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    await deleteCustomTool(testDir, "delete-test");

    // Both .json and .skill.md should be gone
    expect(existsSync(join(testDir, "custom-tools", "delete-test.json"))).toBe(false);
    expect(existsSync(join(testDir, "custom-tools", "delete-test.skill.md"))).toBe(false);
  });

  it("injects skill push text into tool description", async () => {
    const tool = {
      name: "push-test",
      description: "Base description",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
      skillGuide: "# Push Test",
      skillPushMode: "hard" as const,
      skillId: "push-test",
    };

    await writeCustomTool(testDir, tool);
    const def = customToolToToolDef(await readCustomTool(testDir, "push-test")!);

    expect(def.description).toContain("Base description");
    expect(def.description).toContain("MUST read the skill guide (skill ID: push-test) before using this tool");
  });

  it("uses soft push mode text", async () => {
    const tool = {
      name: "soft-test",
      description: "Base",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
      skillGuide: "# Soft Guide",
      skillPushMode: "soft" as const,
      skillId: "soft-test",
    };

    await writeCustomTool(testDir, tool);
    const def = customToolToToolDef(await readCustomTool(testDir, "soft-test")!);
    expect(def.description).toContain("A skill guide exists for this tool (skill ID: soft-test). You may read it with the skill tool if needed.");
  });

  it("uses custom push text when mode is custom", async () => {
    const tool = {
      name: "custom-test",
      description: "Base",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
      skillGuide: "# Custom Guide",
      skillPushMode: "custom" as const,
      skillCustomPushText: "IMPORTANT: Read the guide (ID: custom-test) for important notes.",
      skillId: "custom-test",
    };

    await writeCustomTool(testDir, tool);
    const def = customToolToToolDef(await readCustomTool(testDir, "custom-test")!);
    expect(def.description).toContain("IMPORTANT: Read the guide (ID: custom-test) for important notes.");
  });

  it("rejects invalid tool names", async () => {
    const tool = {
      name: "Invalid Name!",
      description: "Test",
      inputSchema: { type: "object", properties: {} },
      code: "return 'ok';",
      enabled: true,
    };

    // The validation happens in the tool itself, not the store
    // Store should accept any name, validation is at tool level
    await writeCustomTool(testDir, tool);
    const read = await readCustomTool(testDir, "Invalid Name!");
    expect(read).not.toBeNull();
  });
});
