import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

export interface SymbolHit {
  name: string;
  kind: string;
  path: string;
  line: number; // 1-based
  endLine: number; // 1-based inclusive
  preview: string;
}

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
]);

const DEF_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "function", re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
  { kind: "function", re: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/ },
  { kind: "function", re: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/ },
  { kind: "class", re: /^(?:export\s+)?class\s+(\w+)/ },
  { kind: "interface", re: /^(?:export\s+)?interface\s+(\w+)/ },
  { kind: "type", re: /^(?:export\s+)?type\s+(\w+)\s*=/ },
  { kind: "enum", re: /^(?:export\s+)?enum\s+(\w+)/ },
  { kind: "function", re: /^def\s+(\w+)\s*\(/ }, // python
  { kind: "class", re: /^class\s+(\w+)\s*[:\(]/ }, // python
  { kind: "function", re: /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/ }, // go
  { kind: "function", re: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/ }, // rust
];

async function walkFiles(root: string, base: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === ".bun") continue;
    const full = join(base, e.name);
    if (e.isDirectory()) {
      await walkFiles(root, full, out, limit);
    } else if (e.isFile() && CODE_EXT.has(extname(e.name))) {
      out.push(full);
    }
  }
}

function findBlockEnd(lines: string[], startIdx: number): number {
  // brace-balanced end for C-like; for python use indent
  const first = lines[startIdx] ?? "";
  if (first.trimEnd().endsWith(":")) {
    // python-ish: next lines with greater indent
    const baseIndent = (first.match(/^\s*/)?.[0].length ?? 0);
    let end = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") {
        end = i;
        continue;
      }
      const ind = line.match(/^\s*/)?.[0].length ?? 0;
      if (ind <= baseIndent) break;
      end = i;
    }
    return end;
  }

  let depth = 0;
  let seen = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") {
        depth--;
        if (seen && depth === 0) return i;
      }
    }
  }
  return Math.min(startIdx + 40, lines.length - 1);
}

export async function findSymbols(opts: {
  workspaceRoot: string;
  query: string;
  path?: string;
  headLimit: number;
}): Promise<SymbolHit[]> {
  const searchRoot = opts.path ?? opts.workspaceRoot;
  const files: string[] = [];
  const st = await stat(searchRoot).catch(() => null);
  if (st?.isFile()) files.push(searchRoot);
  else await walkFiles(opts.workspaceRoot, searchRoot, files, 2000);

  const q = opts.query.toLowerCase();
  const hits: SymbolHit[] = [];

  for (const file of files) {
    if (hits.length >= opts.headLimit) break;
    let text: string;
    try {
      text = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const lines = text.split(/\r?\n/);
    const rel = relative(opts.workspaceRoot, file) || file;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      for (const { kind, re } of DEF_PATTERNS) {
        const m = trimmed.match(re);
        if (!m) continue;
        const name = m[1];
        if (!name.toLowerCase().includes(q) && name.toLowerCase() !== q) continue;
        const end = findBlockEnd(lines, i);
        hits.push({
          name,
          kind,
          path: rel,
          line: i + 1,
          endLine: end + 1,
          preview: trimmed.slice(0, 120),
        });
        if (hits.length >= opts.headLimit) return hits;
      }
    }
  }

  return hits;
}

export async function readSymbolRange(opts: {
  workspaceRoot: string;
  name: string;
  path?: string;
  contextLines?: number;
}): Promise<SymbolHit | null> {
  const hits = await findSymbols({
    workspaceRoot: opts.workspaceRoot,
    query: opts.name,
    path: opts.path,
    headLimit: 20,
  });
  const exact = hits.find((h) => h.name === opts.name) ?? hits[0];
  if (!exact) return null;
  const ctx = opts.contextLines ?? 0;
  exact.line = Math.max(1, exact.line - ctx);
  // endLine already set; extend slightly for context after
  return exact;
}
