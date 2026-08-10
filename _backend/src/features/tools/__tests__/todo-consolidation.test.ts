import { describe, it, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultRegistry } from "../index";
import { todoTool } from "../consolidated/todo";
import { createSession, getSessionTodosJson } from "../../sessions/db";
import type { BaseToolContext } from "../types";

describe("todo tool consolidation", () => {
  it("registers a single 'todo' tool instead of todowrite/todoread", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("todo");
    expect(names).not.toContain("todowrite");
    expect(names).not.toContain("todoread");
  });

  it("exposes write/read actions and rejects bogus", () => {
    const schema = todoTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(["read", "write"]);

    expect(schema.safeParse({ action: "write", todos: [] }).success).toBe(true);
    expect(schema.safeParse({ action: "read" }).success).toBe(true);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("todo tool has permissionDefault allow", () => {
    const registry = createDefaultRegistry();
    expect(registry.list().find((t) => t.name === "todo")?.permissionDefault).toBe("allow");
  });

  it("todowrite persists to sessions.todos_json via ctx.dataDir (UI strip reads this store)", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "vsh-todo-persist-"));
    const dataDir = join(testDir, "data");
    await mkdir(dataDir, { recursive: true });
    try {
      await createSession(
        {
          id: "persist-todo-session",
          title: "todo persist",
          providerName: "test",
          modelName: "test",
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
        dataDir,
      );

      const ctx: BaseToolContext = {
        sessionId: "persist-todo-session",
        turnId: 1,
        workspaceRoot: testDir,
        dataDir,
        abortSignal: new AbortController().signal,
        callId: "call-todo-persist",
        askPermission: async () => true,
        graphService: null,
        toolSettings: {},
      };

      const res = await todoTool.execute(
        {
          action: "write",
          todos: [{ id: "t1", content: "ship the todo strip fix", status: "in_progress" }],
        } as never,
        ctx,
      );
      expect(res.isError).toBeUndefined();

      // Same store the GET /api/sessions/:id/todos endpoint reads for the UI strip
      const raw = getSessionTodosJson("persist-todo-session", dataDir);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as Array<{ content: string; status: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe("ship the todo strip fix");
      expect(parsed[0].status).toBe("in_progress");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
