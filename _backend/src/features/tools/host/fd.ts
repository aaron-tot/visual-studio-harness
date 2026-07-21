import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { which } from "./which";
import { getRgPath } from "./ripgrep";

export function getFdPath(): string | null {
  return which(["fd", "fdfind"]);
}

export async function runFd(opts: {
  pattern: string;
  cwd: string;
  path?: string;
  headLimit: number;
  abortSignal?: AbortSignal;
}): Promise<{ files: string[]; truncated: boolean }> {
  const fd = getFdPath();
  if (fd) {
    const args = [
      "--color",
      "never",
      "--hidden",
      "--exclude",
      ".git",
      "-n",
      String(opts.headLimit + 1),
      opts.pattern,
    ];
    if (opts.path) args.push(opts.path);

    const proc = Bun.spawn([fd, ...args], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0 && code !== 1) {
      throw new Error(`ERROR glob: fd failed (exit ${code}): ${stderr.slice(0, 400)}`);
    }
    const files = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const truncated = files.length > opts.headLimit;
    return { files: files.slice(0, opts.headLimit), truncated };
  }

  const rg = getRgPath();
  if (rg) {
    const args = ["--files", "--color", "never", "-g", opts.pattern];
    if (opts.path) args.push(opts.path);
    const proc = Bun.spawn([rg, ...args], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0 && code !== 1) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`ERROR glob: rg --files failed: ${stderr.slice(0, 400)}`);
    }
    const files = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, opts.headLimit + 1);
    const truncated = files.length > opts.headLimit;
    return { files: files.slice(0, opts.headLimit), truncated };
  }

  // JS fallback
  const root = opts.path ?? opts.cwd;
  const files: string[] = [];
  await walkMatch(root, opts.cwd, opts.pattern, files, opts.headLimit + 1);
  const truncated = files.length > opts.headLimit;
  return { files: files.slice(0, opts.headLimit), truncated };
}

async function walkMatch(
  base: string,
  cwd: string,
  pattern: string,
  out: string[],
  limit: number
): Promise<void> {
  if (out.length >= limit) return;
  let st;
  try {
    st = await stat(base);
  } catch {
    return;
  }
  if (st.isFile()) {
    const rel = relative(cwd, base) || base;
    const name = base.split(/[/\\]/).pop() || "";
    if (matchPattern(name, rel, pattern)) out.push(rel);
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
    await walkMatch(join(base, e.name), cwd, pattern, out, limit);
  }
}

function matchPattern(name: string, rel: string, pattern: string): boolean {
  // strip **/
  const p = pattern.replace(/^\*\*\//, "");
  if (p.startsWith("*.")) {
    return name.endsWith(p.slice(1));
  }
  if (p.includes("*")) {
    const re = new RegExp("^" + p.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(name) || re.test(rel);
  }
  return name === p || rel.endsWith(p) || name.includes(p);
}
