import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { skillTool } from "./skill";

async function makeTempRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vsh-skill-test-"));
}

type ToolArgs = {
  name?: string;
  mode?: "content" | "path" | "meta" | "list";
  maxDepth?: number;
  filter?: string;
  tags?: string[];
  root?: string;
};

async function execute(args: ToolArgs, agentSettings?: unknown) {
  const result = await skillTool.execute(args as any, { agentSettings } as any);
  return result as { title: string; output: string; metadata?: Record<string, unknown> };
}

/** Build the three-location tree in a temp root:
 *  _tools/<name>/<name>.skill.md, custom-tools/<name>.skill.md, _skills/<name>/prompt.md,
 *  plus a nested tool skill under _skills/<cat>/<nested>.skill.md. */
async function buildTree(root: string): Promise<void> {
  await writeFile(join(root, "_tools", "todo", "todo.skill.md"), "# TODO guide", "utf-8").catch(async () => {
    await mkdir(join(root, "_tools", "todo"), { recursive: true });
    await writeFile(join(root, "_tools", "todo", "todo.skill.md"), "# TODO guide", "utf-8");
  });
  await writeFile(join(root, "custom-tools", "skill-test-tool.skill.md"), "# Skill Test Tool Guide", "utf-8").catch(async () => {
    await mkdir(join(root, "custom-tools"), { recursive: true });
    await writeFile(join(root, "custom-tools", "skill-test-tool.skill.md"), "# Skill Test Tool Guide", "utf-8");
  });
  await writeFile(join(root, "_skills", "research-workflow", "prompt.md"), "# Research Workflow", "utf-8").catch(async () => {
    await mkdir(join(root, "_skills", "research-workflow"), { recursive: true });
    await writeFile(join(root, "_skills", "research-workflow", "prompt.md"), "# Research Workflow", "utf-8");
  });
  await writeFile(join(root, "_skills", "nested", "thing.skill.md"), "# Nested Tool Skill", "utf-8").catch(async () => {
    await mkdir(join(root, "_skills", "nested"), { recursive: true });
    await writeFile(join(root, "_skills", "nested", "thing.skill.md"), "# Nested Tool Skill", "utf-8");
  });
}

async function listNames(root: string, agentSettings?: unknown): Promise<string[]> {
  const r = await execute({ mode: "list", root }, agentSettings);
  const parsed = JSON.parse(r.output) as { skills: Array<{ name: string; marker: string }> };
  return parsed.skills.map((s) => s.name).sort();
}

describe("skill tool discovery across all three locations", () => {
  test("list mode finds builtin tool skills, custom tool skills, and generic skills (incl. nests)", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const names = await listNames(root);
      expect(names).toContain("todo");               // _tools/<name>/<name>.skill.md
      expect(names).toContain("skill-test-tool");     // custom-tools/<name>.skill.md
      expect(names).toContain("research-workflow");   // _skills/<name>/prompt.md
      expect(names).toContain("thing");               // nested _skills/<cat>/<name>.skill.md
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("content mode loads a builtin tool skill guide", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const r = await execute({ name: "todo", root });
      expect(r.output).toContain("# TODO guide");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("content mode loads a custom tool skill guide", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const r = await execute({ name: "skill-test-tool", root });
      expect(r.output).toContain("# Skill Test Tool Guide");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("skill tool access control (skillAccess: attached)", () => {
  test("list mode shows only tool skills + attached generic skills, hiding non-attached generic skills", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const names = await listNames(root, { skillAccess: "attached", skillMds: [] });
      expect(names).toContain("todo");               // tool skill always allowed
      expect(names).toContain("skill-test-tool");     // tool skill always allowed
      expect(names).toContain("thing");               // tool skill always allowed
      expect(names).not.toContain("research-workflow"); // generic, not attached
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("tool skills load regardless of skillMds under attached mode", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const r = await execute({ name: "todo", root }, { skillAccess: "attached", skillMds: [] });
      expect(r.output).toContain("# TODO guide");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a non-attached generic skill is rejected under attached mode", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      await expect(
        execute({ name: "research-workflow", root }, { skillAccess: "attached", skillMds: [] })
      ).rejects.toThrow(/not in allowed skills/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a skill named in skillMds is allowed under attached mode", async () => {
    const root = await makeTempRoot();
    try {
      await buildTree(root);
      const r = await execute(
        { name: "research-workflow", root },
        { skillAccess: "attached", skillMds: [{ name: "research-workflow" }] }
      );
      expect(r.output).toContain("# Research Workflow");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
