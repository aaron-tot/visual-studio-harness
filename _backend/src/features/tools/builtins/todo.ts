import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import {
  getSessionTodosJson,
  setSessionTodosJson,
} from "../../../features/sessions/db";

export const TodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
});

type TodoItem = z.infer<typeof TodoItemSchema>;

const memory = new Map<string, TodoItem[]>();

async function loadFromDisk(dataDir: string, sessionId: string): Promise<TodoItem[] | null> {
  try {
    const raw = getSessionTodosJson(sessionId, dataDir);
    if (!raw) return null;
    return z.array(TodoItemSchema).parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveToDisk(dataDir: string, sessionId: string, todos: TodoItem[]): Promise<void> {
  setSessionTodosJson(sessionId, JSON.stringify(todos), dataDir);
}

export const todoWriteTool: ToolDef = {
  name: "todowrite",
  description:
    "Replace the session todo list (full list each call). Statuses: pending | in_progress | completed | cancelled.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Total number of todo items", required: true },
    { name: "open", type: "integer", description: "Number of non-completed/non-cancelled items", required: true },
  ],
  inputSchema: z.object({
    todos: z.array(TodoItemSchema).describe("Complete updated todo list"),
  }),
  execute: async (args, ctx) => {
    memory.set(ctx.sessionId, args.todos);
    // Persist to sessions.todos_json (SQLite) — the same store the
    // /api/sessions/:id/todos endpoints read for the UI todo strip.
    await saveToDisk(ctx.dataDir, ctx.sessionId, args.todos);
    const open = args.todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
    return {
      title: "todowrite",
      output: JSON.stringify(args.todos, null, 2) + `\n\n(${open} open of ${args.todos.length})`,
    };
  },
};

export const todoReadTool: ToolDef = {
  name: "todoread",
  description: "Read the current session todo list.",
  permissionDefault: "allow",
  outputFields: [
    { name: "count", type: "integer", description: "Number of todo items", required: true },
  ],
  inputSchema: z.object({}),
  execute: async (_args, ctx) => {
    let todos = memory.get(ctx.sessionId);
    if (!todos) {
      todos = (await loadFromDisk(ctx.dataDir, ctx.sessionId)) ?? [];
      memory.set(ctx.sessionId, todos);
    }
    return {
      title: "todoread",
      output: todos.length ? JSON.stringify(todos, null, 2) : "[]",
    };
  },
};
