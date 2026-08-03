import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import {
  todoWriteTool,
  todoReadTool,
  TodoItemSchema,
  setTodoDataDir,
} from "../builtins/todo";

/**
 * Consolidated `todo` tool.
 *
 * Replaces todowrite/todoread with a single registered tool that dispatches on
 * a required `action` enum. Behavior is identical to the originals.
 *
 * Sub-commands (via `action`):
 *   write - Replace the session todo list  (todowrite)
 *   read  - Read the current session todo list (todoread)
 */
const TODO_ACTIONS = ["write", "read"] as const;
export type TodoAction = (typeof TODO_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<TodoAction, ToolDef> = {
  write: todoWriteTool,
  read: todoReadTool,
};

const todosSchema = z.object({
  action: z.enum(TODO_ACTIONS).describe("Operation: write or read"),
  todos: z.array(TodoItemSchema).optional().describe("Complete todo list (write only)"),
});

export const todoTool: ToolDef = {
  name: "todo",
  description:
    "Replace or read the session todo list. Set 'action' to write (replace the full list) or read. " +
    "See skill:todo for the todo model and statuses.",
  permissionDefault: "allow",
  inputSchema: todosSchema,
  execute: async (args, ctx) => {
    const action = args.action as TodoAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown todo action: "${String(args.action)}".`,
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const todoActions = TODO_ACTIONS;
export { setTodoDataDir };
