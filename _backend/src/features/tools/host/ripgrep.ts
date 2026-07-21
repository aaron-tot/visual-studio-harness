import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { which } from "./which";

export function getRgPath(): string | null {
  return which("rg");
}

export interface RgMatch {
  path: string;
  line: number;
  text: string;
}

export async function runRipgrep(opts: {
  pattern: string;
  cwd: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
  headLimit: number;
  abortSignal?: AbortSignal;
}): Promise<{ matches: RgMatch[]; truncated: boolean }> {
  const rg = getRgPath();
  if (rg) {
    return runRgBinary(rg, opts);
  }
  return runJsGrep(opts);
}

async function runRgBinary(
  rg: string,
  opts: {
    pattern: string;
    cwd: string;
    path?: string;
    glob?: string;
    caseInsensitive?: boolean;
    headLimit: number;
    abortSignal?: AbortSignal;
  }
): Promise<{ matches: RgMatch[]; truncated: boolean }> {
  const args = [
    "--json",
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "-m",
    String(opts.headLimit + 1),
  ];
  if (opts.caseInsensitive) args.push("-i");
  if (opts.glob) args.push("--glob", opts.glob);
  args.push("--", opts.pattern);
  if (opts.path) args.push(opts.path);
  else args.push(".");

  const proc = Bun.spawn([rg, ...args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0 && code !== 1) {
    throw new Error(`ERROR grep: ripgrep failed (exit ${code}): ${stderr.slice(0, 400)}`);
  }

  const matches: RgMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "match") continue;
      const data = obj.data;
      const text = data.lines?.text ?? "";
      matches.push({
        path: data.path?.text ?? "",
        line: data.line_number ?? 0,
        text: text.replace(/\n$/, ""),
      });
    } catch {
      // ignore
    }
  }

  const truncated = matches.length > opts.headLimit;
  return { matches: matches.slice(0, opts.headLimit), truncated };
}

/** Slow but dependency-free fallback when rg is not installed. */
async function runJsGrep(opts: {
  pattern: string;
  cwd: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
  headLimit: number;
}): Promise<{ matches: RgMatch[]; truncated: boolean }> {
  let re: RegExp;
  try {
    re = new RegExp(opts.pattern, opts.caseInsensitive ? "i" : undefined);
  } catch {
    throw new Error(`ERROR grep: invalid regex: ${opts.pattern}`);
  }

  const root = opts.path ?? opts.cwd;
  const files: string[] = [];
  await collectFiles(root, files, 2000, opts.glob);
  const matches: RgMatch[] = [];

  for (const file of files) {
    if (matches.length >= opts.headLimit) break;
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        matches.push({
          path: relative(opts.cwd, file) || file,
          line: i + 1,
          text: lines[i],
        });
        if (matches.length >= opts.headLimit) {
          return { matches, truncated: true };
        }
      }
    }
  }
  return { matches, truncated: false };
}

async function collectFiles(
  base: string,
  out: string[],
  limit: number,
  glob?: string
): Promise<void> {
  if (out.length >= limit) return;
  let st;
  try {
    st = await stat(base);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (!glob || matchSimpleGlob(base, glob)) out.push(base);
    return;
  }
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    await collectFiles(join(base, e.name), out, limit, glob);
  }
}

function matchSimpleGlob(filePath: string, glob: string): boolean {
  // very small matcher: *.ts, **/*.ts
  const name = filePath.split(/[/\\]/).pop() || "";
  if (glob.startsWith("*.") || glob.includes("/*.")) {
    const ext = glob.slice(glob.lastIndexOf("."));
    return name.endsWith(ext);
  }
  return name.includes(glob.replace(/\*/g, ""));
}
