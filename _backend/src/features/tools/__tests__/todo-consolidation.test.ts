import { describe, it, expect } from "bun:test";
import { createDefaultRegistry } from "../index";
import { todoTool } from "../consolidated/todo";

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
});
