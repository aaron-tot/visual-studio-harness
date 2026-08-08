/**
 * Builtin `todo` tool — self-contained ctx entry.
 * Consolidated dispatcher: write / read.
 * write replaces the full session todo list (todowrite semantics); read returns
 * it (todoread semantics).
 * Ported from builtins/todo.ts, storing through ctx.services
 * (getSessionTodosJson/setSessionTodosJson) instead of the old module-level
 * dataDir global.
 */
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

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "write":
      return actionWrite(args, ctx);
    case "read":
      return actionRead(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown todo action: "${String(action)}".`,
    isError: true,
  };
}
