/**
 * Builtin `notes` tool — self-contained ctx entry.
 * Consolidated dispatcher: read / create / update / archive.
 * Ported from builtins/notes_{read,create,update,archive}.ts.
 * Uses ctx.services (createNote/updateNote/archiveNote/resolveNotesDir)
 * and node:fs for the read path.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

type Scope = "global" | "project" | "session";

async function actionCreate(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const result = await ctx.services.createNote({
    name: args.name,
    title: args.title,
    body: args.body,
    scope,
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
  });
  return {
    title: "Note created",
    output: `Created note "${args.title}" as "${args.name}" in ${scope} scope.`,
    metadata: { created: true, path: result.path },
  };
}

async function actionRead(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const notesDir = ctx.services.resolveNotesDir(scope, ctx.workspaceRoot, ctx.sessionId);
  if (!notesDir) {
    return {
      title: "Error",
      output: `Cannot resolve notes directory for scope "${scope}".`,
      metadata: { found: false },
      isError: true,
    };
  }
  const fp = join(notesDir, args.name, "note.json");
  if (!existsSync(fp)) {
    return {
      title: "Not found",
      output: `Note "${args.name}" not found in "${scope}" scope.`,
      metadata: { found: false },
    };
  }
  const raw = await readFile(fp, "utf-8");
  const data = JSON.parse(raw);
  return {
    title: data.title || args.name,
    output: raw,
    metadata: { found: true, name: args.name, title: data.title || args.name },
  };
}

async function actionUpdate(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const result = await ctx.services.updateNote({
    name: args.name,
    title: args.title,
    body: args.body,
    scope,
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
  });
  return {
    title: "Note updated",
    output: `Updated note "${args.name}" in ${scope} scope.`,
    metadata: { updated: true, path: result.path },
  };
}

async function actionArchive(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const result = await ctx.services.archiveNote({
    name: args.name,
    scope,
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
  });
  return {
    title: "Note archived",
    output: `Archived note "${args.name}" in ${scope} scope → ${result.archivedPath}`,
    metadata: { archived: true, archivedPath: result.archivedPath },
  };
}

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "read":
      return actionRead(args, ctx);
    case "create":
      return actionCreate(args, ctx);
    case "update":
      return actionUpdate(args, ctx);
    case "archive":
      return actionArchive(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown notes action: "${String(action)}".`,
    metadata: { found: false },
    isError: true,
  };
}
