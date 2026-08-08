/**
 * Builtin `todo` tool — self-contained ctx entry.
 * Consolidated dispatcher: write / read / add / update / remove / clear / list.
 * write replaces the full session todo list (todowrite semantics); read returns
 * it (todoread semantics). add/update/remove/clear/list manage the same store.
 * Ported from builtins/todo.ts, storing through ctx.services
 * (getSessionTodosJson/setSessionTodosJson) instead of the old module-level
 * dataDir global.
 */
import { randomUUID } from "node:crypto";

const STATUSES = ["pending", "in_progress", "completed", "cancelled"];

function loadList(ctx: any): any[] {
  const raw = ctx.services.getSessionTodosJson(ctx.sessionId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveList(ctx: any, todos: any[]): void {
  ctx.services.setSessionTodosJson(ctx.sessionId, JSON.stringify(todos));
}

function countOpen(todos: any[]): number {
  return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
}

async function actionWrite(args: any, ctx: any) {
  const todos: any[] = Array.isArray(args.todos) ? args.todos : [];
  saveList(ctx, todos);
  const open = countOpen(todos);
  return {
    title: "todo",
    output: JSON.stringify(todos, null, 2) + `\n\n(${open} open of ${todos.length})`,
  };
}

async function actionRead(_args: any, ctx: any) {
  const todos = loadList(ctx);
  return { title: "todo", output: todos.length ? JSON.stringify(todos, null, 2) : "[]" };
}

async function actionList(_args: any, ctx: any) {
  const todos = loadList(ctx);
  return {
    title: "todo",
    output: todos.length ? JSON.stringify(todos, null, 2) : "[]",
    metadata: { count: todos.length },
  };
}

async function actionAdd(args: any, ctx: any) {
  const todos = loadList(ctx);
  const status = STATUSES.includes(args.status) ? args.status : "pending";
  const item = {
    id: args.id ?? randomUUID(),
    content: String(args.content ?? ""),
    status,
    ...(args.priority !== undefined ? { priority: args.priority } : {}),
  };
  todos.push(item);
  saveList(ctx, todos);
  return {
    title: "Todo added",
    output: `Added todo: ${item.content}`,
    metadata: { added: true, id: item.id, count: todos.length },
  };
}

async function actionUpdate(args: any, ctx: any) {
  const todos = loadList(ctx);
  const idx = todos.findIndex((t) => t.id === args.id);
  if (idx < 0) {
    return {
      title: "Not found",
      output: `Todo "${args.id}" not found.`,
      metadata: { updated: false },
    };
  }
  const next = { ...todos[idx] };
  if (args.content !== undefined) next.content = String(args.content);
  if (args.status !== undefined && STATUSES.includes(args.status)) next.status = args.status;
  if (args.priority !== undefined) next.priority = args.priority;
  todos[idx] = next;
  saveList(ctx, todos);
  return {
    title: "Todo updated",
    output: `Updated todo "${args.id}".`,
    metadata: { updated: true, id: args.id, count: todos.length },
  };
}

async function actionRemove(args: any, ctx: any) {
  const todos = loadList(ctx);
  const next = todos.filter((t) => t.id !== args.id);
  if (next.length === todos.length) {
    return {
      title: "Not found",
      output: `Todo "${args.id}" not found.`,
      metadata: { removed: false },
    };
  }
  saveList(ctx, next);
  return {
    title: "Todo removed",
    output: `Removed todo "${args.id}".`,
    metadata: { removed: true, count: next.length },
  };
}

async function actionClear(_args: any, ctx: any) {
  saveList(ctx, []);
  return {
    title: "Todos cleared",
    output: "Cleared all todos.",
    metadata: { cleared: true, count: 0 },
  };
}

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "write":
      return actionWrite(args, ctx);
    case "read":
      return actionRead(args, ctx);
    case "list":
      return actionList(args, ctx);
    case "add":
      return actionAdd(args, ctx);
    case "update":
      return actionUpdate(args, ctx);
    case "remove":
      return actionRemove(args, ctx);
    case "clear":
      return actionClear(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown todo action: "${String(action)}".`,
    isError: true,
  };
}
