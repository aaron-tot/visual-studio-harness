/**
 * Builtin `knowledge` tool — self-contained ctx entry.
 * Consolidated dispatcher: search / open / ingest / doc_create / doc_edit /
 * doc_delete / list.
 * Ported from builtins/knowledge_{search,open,ingest}.ts +
 * knowledge_document_{create,edit,delete}.ts. Uses ctx.services.knowledgeBase
 * (KnowledgeBaseService + openDocumentByIdOrFilename + AGENT_FILENAME_PREFIX).
 * The KB may be unavailable/disabled — every action degrades to an error result
 * rather than throwing.
 */
type Scope = "global" | "project" | "session";

function gracefulError(title: string, err: unknown): {
  title: string;
  output: string;
  isError: boolean;
} {
  return { title, output: err instanceof Error ? err.message : String(err), isError: true };
}

async function actionSearch(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const { results, hybrid, total } = await kb.search(
      (args.scope as Scope) || "global",
      args.query,
      { limit: args.limit, mode: args.mode, filters: args.filters },
      ctx.workspaceRoot,
      ctx.sessionId
    );

    if (results.length === 0) {
      return {
        title: "No knowledge found",
        output: `No results for query: "${args.query}"`,
        metadata: { count: 0, total, hybrid },
      };
    }

    const lines = results.map(
      (r: any) =>
        `  [${r.score.toFixed(2)}] ${r.filename} → ${r.section}\n` +
        `       ${r.content.slice(0, 200)}...`
    );

    return {
      title: `${results.length} knowledge result(s) for "${args.query}"`,
      output: lines.join("\n\n"),
      metadata: { count: results.length, total, hybrid },
    };
  } catch (err) {
    return gracefulError("Knowledge search unavailable", err);
  }
}

async function actionOpen(args: any, ctx: any) {
  try {
    const scope = (args.scope as Scope) || "global";
    const doc = await ctx.services.openDocumentByIdOrFilename(
      scope,
      args.documentId,
      args.maxChars,
      ctx.workspaceRoot,
      ctx.sessionId
    );
    if (!doc) {
      return { title: "Document not found", output: `No document found: ${args.documentId}` };
    }
    return {
      title: doc.filename,
      output: doc.content,
      metadata: { filename: doc.filename },
    };
  } catch (err) {
    return gracefulError("Knowledge open unavailable", err);
  }
}

async function actionIngest(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const result = await kb.ingest(
      (args.scope as Scope) || "global",
      ctx.workspaceRoot,
      ctx.sessionId
    );
    return {
      title: "Ingestion triggered",
      output: `Scan complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted${
        result.failed.length > 0 ? `, ${result.failed.length} failed` : ""
      }`,
      metadata: {
        added: result.added,
        updated: result.updated,
        deleted: result.deleted,
        failed: result.failed.length,
      },
    };
  } catch (err) {
    return gracefulError("Knowledge ingest unavailable", err);
  }
}

async function actionDocCreate(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const prefixedFilename = `${ctx.services.AGENT_FILENAME_PREFIX}${args.filename}`;
    const doc = await kb.createDocument(
      (args.scope as Scope) || "global",
      {
        filename: prefixedFilename,
        content: args.content,
        tags: args.tags,
        scope: args.scope || "global",
        createdBy: "agent",
      },
      ctx.workspaceRoot,
      ctx.sessionId
    );
    return {
      title: "Document created",
      output: `Created ${doc.filename} (ID: ${doc.id})`,
      metadata: { id: doc.id, filename: doc.filename, scope: args.scope },
    };
  } catch (err) {
    return gracefulError("Knowledge document create unavailable", err);
  }
}

async function actionDocEdit(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const doc = await kb.editDocument(
      (args.scope as Scope) || "global",
      args.documentId,
      args.content,
      ctx.workspaceRoot,
      ctx.sessionId
    );
    return {
      title: "Document updated",
      output: `Updated ${doc.filename}`,
      metadata: { id: doc.id, filename: doc.filename },
    };
  } catch (err) {
    return gracefulError("Knowledge document edit unavailable", err);
  }
}

async function actionDocDelete(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const result = await kb.deleteDocument(
      (args.scope as Scope) || "global",
      args.documentId,
      args.confirmed,
      ctx.workspaceRoot,
      ctx.sessionId
    );
    if (!result.ok) {
      return { title: "Delete failed", output: result.error || "Unknown error", isError: true };
    }
    return {
      title: "Document deleted",
      output: `Document ${args.documentId} deleted successfully.`,
    };
  } catch (err) {
    return gracefulError("Knowledge document delete unavailable", err);
  }
}

async function actionList(args: any, ctx: any) {
  try {
    const kb = new ctx.services.KnowledgeBaseService(ctx.dataDir);
    const scope = (args.scope as Scope) || "global";
    const docs = await kb.listDocuments(
      scope,
      { extension: args.extension, createdBy: args.createdBy },
      ctx.workspaceRoot,
      ctx.sessionId
    );
    if (docs.length === 0) {
      return {
        title: "No knowledge documents",
        output: `No knowledge documents found in "${scope}" scope.`,
        metadata: { count: 0, scope },
      };
    }
    const lines = docs.map(
      (d: any) =>
        `  ID:${d.id}  ${d.filename}  (${d.extension ?? ""}, ${d.fileSize} bytes, status: ${d.status}` +
        `${d.tags?.length ? `, tags: ${d.tags.join(", ")}` : ""}` +
        `${d.createdBy ? `, by: ${d.createdBy}` : ""})`
    );
    return {
      title: `${docs.length} knowledge document(s) in ${scope} scope`,
      output: lines.join("\n"),
      metadata: { count: docs.length, scope },
    };
  } catch (err) {
    return gracefulError("Knowledge list unavailable", err);
  }
}

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "search":
      return actionSearch(args, ctx);
    case "open":
      return actionOpen(args, ctx);
    case "ingest":
      return actionIngest(args, ctx);
    case "doc_create":
      return actionDocCreate(args, ctx);
    case "doc_edit":
      return actionDocEdit(args, ctx);
    case "doc_delete":
      return actionDocDelete(args, ctx);
    case "list":
      return actionList(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown knowledge action: "${String(action)}".`,
    metadata: { found: false },
    isError: true,
  };
}
