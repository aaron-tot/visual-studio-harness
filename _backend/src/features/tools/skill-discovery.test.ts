import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverSkills } from "./builtins/skill";
import { registerSkillsRoutes } from "../../rest/skills";
import { seedBuiltinToolFolders } from "./folder-seed";
import { loadToolsFromFolders } from "./folder-store";
import type { BaseToolContext } from "./types";

async function makeTempRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "vsh-skill-discovery-"));
}

function fakeBaseCtx(dataDir: string): BaseToolContext {
  return {
    sessionId: "sess-skills",
    turnId: 1,
    workspaceRoot: join(dataDir, "ws"),
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-skills",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
  };
}

/** Build a minimal data/tools tree with a builtin + a custom guide (skill.md + prompt.json). */
async function buildToolGuideTree(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, "tools", "builtin", "todo"), { recursive: true });
  await writeFile(join(dataDir, "tools", "builtin", "todo", "skill.md"), "# todo guide\n", "utf-8");
  await writeFile(
    join(dataDir, "tools", "builtin", "todo", "prompt.json"),
    JSON.stringify({ tags: ["todo", "task-list"] }),
    "utf-8"
  );

  await mkdir(join(dataDir, "tools", "custom", "my-tool"), { recursive: true });
  await writeFile(join(dataDir, "tools", "custom", "my-tool", "skill.md"), "# my-tool guide\n", "utf-8");
  await writeFile(
    join(dataDir, "tools", "custom", "my-tool", "prompt.json"),
    JSON.stringify({ tags: ["custom", "user-defined"] }),
    "utf-8"
  );
}

describe("skill discovery from tool folders", () => {
  test("shared discovery (used by /api/skills) finds builtin + custom guides as tool-skill markers with tags", async () => {
    const dataDir = await makeTempRoot();
    try {
      await buildToolGuideTree(dataDir);

      // Same roots the /api/skills endpoint uses.
      const roots = [
        join(dataDir, "mds", "_skills"),
        join(dataDir, "tools", "builtin"),
        join(dataDir, "tools", "custom"),
      ];
      const skills = await discoverSkills(roots, 3);

      const todo = skills.find((s) => s.name === "todo");
      expect(todo).toBeDefined();
      expect(todo!.marker).toBe("tool-skill");
      expect(todo!.path).toBe(join(dataDir, "tools", "builtin", "todo", "skill.md"));
      expect(todo!.tags).toEqual(expect.arrayContaining(["todo", "task-list"]));
      expect(todo!.hasPromptJson).toBe(true);

      const myTool = skills.find((s) => s.name === "my-tool");
      expect(myTool).toBeDefined();
      expect(myTool!.marker).toBe("tool-skill");
      expect(myTool!.path).toBe(join(dataDir, "tools", "custom", "my-tool", "skill.md"));
      expect(myTool!.tags).toEqual(expect.arrayContaining(["custom", "user-defined"]));
      expect(myTool!.hasPromptJson).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("/api/skills returns builtin + custom tool guide names from the tool folders", async () => {
    const dataDir = await makeTempRoot();
    try {
      await buildToolGuideTree(dataDir);

      // Minimal Fastify stand-in capturing the route handler.
      let handler: (() => Promise<unknown>) | undefined;
      const app = {
        get: (_path: string, h: () => Promise<unknown>) => {
          handler = h;
        },
      };
      registerSkillsRoutes(app as never, dataDir);

      expect(handler).toBeDefined();
      const names = (await handler!()) as string[];
      expect(names).toContain("todo");
      expect(names).toContain("my-tool");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("folder skill entry finds a guide at data/tools/builtin/<name>/skill.md", async () => {
    const dataDir = await makeTempRoot();
    try {
      // Clone the real builtin seeds (todo ships skill.md + prompt.json) and load
      // the folder skill entry the way run-turn does (createFolderRegistry path).
      await seedBuiltinToolFolders(dataDir, "dev");
      const defs = await loadToolsFromFolders(dataDir);
      const skill = defs.find((d) => d.name === "skill")!;
      expect(skill).toBeDefined();

      const ctx = fakeBaseCtx(dataDir);

      // list mode surfaces the todo guide discovered inside data/tools/builtin.
      const list = (await skill.execute({ mode: "list" }, ctx)) as { output: string };
      expect(list.output).toContain("todo");

      // content mode reads the skill.md guide file from the tool folder.
      const read = (await skill.execute({ name: "todo" }, ctx)) as { output: string };
      expect(read.output).toContain("# todo");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
