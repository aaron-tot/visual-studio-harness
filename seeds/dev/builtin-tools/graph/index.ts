/**
 * Builtin `graph` tool — self-contained ctx entry.
 * Consolidated dispatcher: search / files / info / imports / exports /
 * manifest / status / symbol_find / symbol_read.
 * Graph-index actions use ctx.graphService (may be null — handled gracefully).
 * symbol_find / symbol_read use the regex scanner helpers on ctx.
 * Ported from builtins/graph_{search,files,info,imports,exports,manifest,status}.ts +
 * builtins/find_symbol.ts + builtins/read_symbol.ts.
 */
import { readFile } from "node:fs/promises";

function unavailable(title: string): { title: string; output: string; isError: boolean } {
  return { title, output: "Graph service not available", isError: true };
}

async function actionSearch(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_search");
  const matches = await ctx.graphService.query.findSymbol(args.name, args.kind);
  if (matches.length === 0) {
    return { title: "graph_search", output: `No symbols matching '${args.name}'` };
  }
  const lines = matches.map(
    (m: any) =>
      `${m.symbol.kind} ${m.symbol.name} — ${m.filePath}:${m.symbol.startLine}-${m.symbol.endLine}` +
      (m.symbol.exported ? " [exported]" : "") +
      (m.symbol.async ? " [async]" : "") +
      (m.symbol.signature ? `\n  signature: ${m.symbol.signature}` : "")
  );
  return { title: "graph_search", output: lines.join("\n") };
}

async function actionFiles(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_files");
  const files = await ctx.graphService.query.listFiles(args.folder_path);
  if (files.length === 0) {
    return { title: "graph_files", output: "No indexed files found" };
  }
  const lines = files.map(
    (f: any) => `${f.path} [${f.language}] ${f.size}B modified=${new Date(f.modifiedMs).toISOString()}`
  );
  return { title: "graph_files", output: `${files.length} files:\n${lines.join("\n")}` };
}

async function actionInfo(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_info");
  const [imports, exports, symbols] = await Promise.all([
    ctx.graphService.query.listImports(args.file_path),
    ctx.graphService.query.listExports(args.file_path),
    ctx.graphService.query.findSymbolsByFile(args.file_path),
  ]);

  const sections: string[] = [];
  sections.push(`File: ${args.file_path}`);
  sections.push(`Symbols: ${symbols.length}`);
  if (symbols.length > 0) {
    for (const s of symbols) {
      sections.push(`  ${s.symbol.kind} ${s.symbol.name} L${s.symbol.startLine}-${s.symbol.endLine}`);
    }
  }
  sections.push(`Imports: ${imports.length}`);
  if (imports.length > 0) {
    for (const imp of imports) {
      sections.push(`  ${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`);
    }
  }
  sections.push(`Exports: ${exports.length}`);
  if (exports.length > 0) {
    for (const exp of exports) {
      sections.push(`  ${exp.isDefault ? "default " : ""}${exp.symbol}`);
    }
  }
  return { title: "graph_info", output: sections.join("\n") };
}

async function actionImports(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_imports");
  const imports = await ctx.graphService.query.listImports(args.file_path);
  if (imports.length === 0) {
    return { title: "graph_imports", output: `No imports in ${args.file_path}` };
  }
  const lines = imports.map(
    (imp: any) => `${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`
  );
  return { title: "graph_imports", output: lines.join("\n") };
}

async function actionExports(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_exports");
  const exports = await ctx.graphService.query.listExports(args.file_path);
  if (exports.length === 0) {
    return { title: "graph_exports", output: `No exports in ${args.file_path}` };
  }
  const lines = exports.map((exp: any) => `${exp.isDefault ? "default " : ""}${exp.symbol}`);
  return { title: "graph_exports", output: lines.join("\n") };
}

async function actionManifest(args: any, ctx: any) {
  if (!ctx.graphService) return unavailable("graph_manifest");
  const manifest = await ctx.graphService.manifest.workspaceManifest({
    maxDepth: args.max_depth,
    includeFiles: args.include_files,
  });
  if (!manifest) {
    return {
      title: "graph_manifest",
      output: "No manifest data (workspace may not be indexed)",
    };
  }
  return { title: "graph_manifest", output: manifest };
}

async function actionStatus(_args: any, ctx: any) {
  if (!ctx.graphService) {
    return {
      title: "graph_status",
      output: "Graph service not available (workspace graph may be disabled or still initializing)",
      isError: true,
    };
  }
  const status = await ctx.graphService.getStatus();
  const lines = [
    `Files: ${status.fileCount}`,
    `Folders: ${status.folderCount}`,
    `Symbols: ${status.symbolCount}`,
    `Languages: ${status.languages.join(", ") || "none"}`,
    `Last indexed: ${status.lastIndexedAt ? new Date(status.lastIndexedAt).toISOString() : "never"}`,
    `DB path: ${status.dbPath}`,
  ];
  return { title: "graph_status", output: lines.join("\n") };
}

async function actionSymbolFind(args: any, ctx: any) {
  const searchPath = args.path ? await ctx.resolveAccessiblePath(String(args.path)) : undefined;
  const hits = await ctx.findSymbols({
    workspaceRoot: ctx.workspaceRoot,
    query: String(args.query ?? ""),
    path: searchPath,
    headLimit: args.head_limit ?? 20,
  });
  if (hits.length === 0) {
    return { title: "find_symbol", output: `No symbols matching '${args.query}'` };
  }
  const lines = hits.map((h: any) => `${h.path}:${h.line}-${h.endLine} ${h.kind} ${h.name}  ${h.preview}`);
  return { title: "find_symbol", output: lines.join("\n") };
}

async function actionSymbolRead(args: any, ctx: any) {
  const searchPath = args.path ? await ctx.resolveAccessiblePath(String(args.path)) : undefined;
  const hit = await ctx.readSymbolRange({
    workspaceRoot: ctx.workspaceRoot,
    name: String(args.name ?? ""),
    path: searchPath,
    contextLines: args.context_lines ?? 3,
  });
  if (!hit) {
    throw new ctx.SandboxError(`ERROR read_symbol: symbol '${args.name}' not found`);
  }

  const abs = await ctx.resolveAccessiblePath(hit.path);
  const text = await readFile(abs, "utf-8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, hit.line - 1);
  const end = Math.min(lines.length, hit.endLine + (args.context_lines ?? 3));
  const slice = lines.slice(start, end);
  const body = ctx.formatNumberedLines(slice, start + 1);
  return {
    title: `${hit.name} @ ${hit.path}:${hit.line}`,
    output: `${hit.kind} ${hit.name} — ${hit.path}:${hit.line}-${end}\n\n${body}`,
  };
}

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "search":
      return actionSearch(args, ctx);
    case "files":
      return actionFiles(args, ctx);
    case "info":
      return actionInfo(args, ctx);
    case "imports":
      return actionImports(args, ctx);
    case "exports":
      return actionExports(args, ctx);
    case "manifest":
      return actionManifest(args, ctx);
    case "status":
      return actionStatus(args, ctx);
    case "symbol_find":
      return actionSymbolFind(args, ctx);
    case "symbol_read":
      return actionSymbolRead(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown graph action: "${String(action)}".`,
    metadata: { found: false },
    isError: true,
  };
}
