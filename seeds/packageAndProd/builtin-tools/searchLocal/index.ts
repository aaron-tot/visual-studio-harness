/**
 * Builtin `searchLocal` tool — self-contained ctx entry.
 * grep and glob were consolidated into this single tool (dispatch on `action`).
 *   - grep: regex content search via ctx.runRipgrep (respects .gitignore)
 *   - glob: find files by name/glob via ctx.runFd (rg fallback; JS fallback)
 * Ported from builtins/grep.ts + builtins/glob.ts execute bodies.
 */
import { relative } from "node:path";

const DEFAULT_GLOB_MAX_PATHS = 200;

async function runGrep(args: Record<string, unknown>, ctx: any): Promise<any> {
  const pattern = String(args.pattern ?? "");
  const searchPath = args.path
    ? await ctx.resolveAccessiblePath(String(args.path))
    : ctx.workspaceRoot;
  const limit =
    typeof args.head_limit === "number" ? args.head_limit : ctx.DEFAULT_GREP_MAX_MATCHES;

  const { matches, truncated } = await ctx.runRipgrep({
    pattern,
    cwd: ctx.workspaceRoot,
    path: searchPath === ctx.workspaceRoot ? undefined : searchPath,
    glob: args.glob as string | undefined,
    caseInsensitive: args.case_insensitive === true,
    headLimit: limit,
    abortSignal: ctx.abortSignal,
  });

  if (matches.length === 0) {
    return { title: "searchLocal", output: `No matches for /${pattern}/` };
  }

  const lines = matches.map((m: any) => {
    const rel = m.path.startsWith(ctx.workspaceRoot)
      ? relative(ctx.workspaceRoot, m.path)
      : m.path;
    return `${rel}:${m.line}:${ctx.clipLine(m.text)}`;
  });

  let out = lines.join("\n");
  if (truncated) out += `\n\n(truncated: showing first ${limit} matches)`;
  return {
    title: "searchLocal",
    output: out,
    metadata: { count: matches.length, truncated },
  };
}

async function runGlob(args: Record<string, unknown>, ctx: any): Promise<any> {
  const pattern = String(args.pattern ?? "");
  const searchPath = args.path
    ? await ctx.resolveAccessiblePath(String(args.path))
    : undefined;
  const limit = typeof args.head_limit === "number" ? args.head_limit : DEFAULT_GLOB_MAX_PATHS;

  const { files, truncated } = await ctx.runFd({
    pattern,
    cwd: ctx.workspaceRoot,
    path: searchPath,
    headLimit: limit,
    abortSignal: ctx.abortSignal,
  });

  if (files.length === 0) {
    return { title: "searchLocal", output: `No files matching ${pattern}` };
  }

  let out = files.join("\n");
  if (truncated) out += `\n\n(truncated: showing first ${limit} paths)`;
  return {
    title: "searchLocal",
    output: out,
    metadata: { count: files.length, truncated },
  };
}

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<any> {
  const action = args.action;
  if (action === "grep") return runGrep(args, ctx);
  if (action === "glob") return runGlob(args, ctx);
  return {
    title: "searchLocal",
    output: `Unknown searchLocal action: "${String(action)}".`,
    isError: true,
  };
}
