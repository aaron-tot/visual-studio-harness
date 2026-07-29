import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isIgnored, isSourceFile, getLanguage } from "./ignore";
import { computeSourceHash } from "./hash";
import type { ScannedFile, ScanResult, ScanInput } from "../types";

export async function scanWorkspace(input: ScanInput): Promise<ScanResult> {
  const {
    workspaceRoot,
    existingIndex,
    includeExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    excludeDirs = ["node_modules", ".git", "dist", "build", ".vsh", "coverage", ".turbo"],
  } = input;

  const diskFiles = await collectSourceFiles(workspaceRoot, includeExtensions, excludeDirs);
  const byPath = new Map(existingIndex.map((row) => [row.path, row]));

  const created: ScannedFile[] = [];
  const modified: ScannedFile[] = [];
  const unchanged: { path: string; fileHash: string; modifiedMs: number }[] = [];
  const deleted: { path: string; fileHash: string; modifiedMs: number }[] = [];

  for (const diskFile of diskFiles) {
    const old = byPath.get(diskFile.path);
    if (!old) {
      created.push(diskFile);
    } else if (old.fileHash !== diskFile.fileHash || old.modifiedMs !== diskFile.modifiedMs) {
      modified.push(diskFile);
    } else {
      unchanged.push(old);
    }
    byPath.delete(diskFile.path);
  }

  for (const [, stale] of byPath) {
    deleted.push(stale);
  }

  return { created, modified, deleted, unchanged };
}

async function collectSourceFiles(
  dir: string,
  includeExtensions: string[],
  excludeDirs: string[]
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  await collectFiles(dir, dir, includeExtensions, excludeDirs, results);
  return results;
}

async function collectFiles(
  rootDir: string,
  currentDir: string,
  includeExtensions: string[],
  excludeDirs: string[],
  results: ScannedFile[]
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry);
    const relPath = relative(rootDir, fullPath);

    let st;
    try {
      st = await stat(fullPath);
    } catch {
      continue;
    }

    if (st.isDirectory()) {
      const dirName = entry;
      if (dirName.startsWith(".") || excludeDirs.includes(dirName)) continue;
      await collectFiles(rootDir, fullPath, includeExtensions, excludeDirs, results);
      continue;
    }

    if (isIgnored(relPath, excludeDirs)) continue;
    if (!isSourceFile(entry, includeExtensions)) continue;

    try {
      const sourceText = await readFile(fullPath, "utf-8");
      const fileHash = computeSourceHash(sourceText);
      const dot = entry.lastIndexOf(".");
      const ext = dot > 0 ? entry.slice(dot) : "unknown";

      results.push({
        path: relPath,
        filename: entry,
        extension: ext,
        language: getLanguage(ext),
        size: st.size,
        modifiedMs: st.mtimeMs,
        fileHash,
        sourceText,
      });
    } catch {
      // skip unreadable files
    }
  }
}
