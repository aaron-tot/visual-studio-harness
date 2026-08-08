import { mkdir, readdir, copyFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_TOOL_NAMES } from "./index";
import { seedsDir, seedSubdirForMode } from "../mds/paths";

let seedRootOverride: string | null | undefined;

let copyFailureForTest: string | null | undefined;

/**
 * Override the seed root for tests (e.g. a temp dir with a partial
 * `builtin-tools/` tree). Passing null simulates a compiled binary with no
 * bundled seeds. Pass nothing (undefined) to clear the override and fall back
 * to the repo seeds.
 */
export function setSeedRootForTest(root?: string | null): void {
  seedRootOverride = root;
}

/**
 * Test hook: when set to a file name, copyTree throws while copying a file
 * entry with that name, simulating a mid-copy failure. Pass nothing
 * (undefined) to clear the hook and fall back to real copying.
 */
export function setCopyFailureForTest(fileName?: string | null): void {
  copyFailureForTest = fileName;
}

function resolveSeedRoot(): string | null {
  return seedRootOverride !== undefined ? seedRootOverride : seedsDir();
}

/**
 * Clone builtin tool folders from source defaults on first run.
 *
 * For every builtin tool name, if `data/tools/builtin/<name>/` does NOT exist,
 * the ENTIRE folder is copied from `seeds/{mode}/builtin-tools/<name>/`
 * (mode = "dev" for dev, "packageAndProd" otherwise). Existing folders are
 * NEVER overwritten (the data copy is authoritative). Missing seed folders are
 * skipped gracefully.
 *
 * @returns the number of folders cloned.
 */
export async function seedBuiltinToolFolders(dataDir: string, mode: string): Promise<number> {
  const seedRoot = resolveSeedRoot();
  if (!seedRoot) return 0; // running under a compiled binary with no bundled seeds

  const seedToolsDir = join(seedRoot, seedSubdirForMode(mode), "builtin-tools");
  const builtinRoot = join(dataDir, "tools", "builtin");

  let cloned = 0;
  for (const name of BUILTIN_TOOL_NAMES) {
    const seedDir = join(seedToolsDir, name);
    if (!existsSync(seedDir)) continue; // no seed folder for this builtin — skip

    const targetDir = join(builtinRoot, name);
    if (existsSync(targetDir)) continue; // never overwrite an existing data copy

    // Copy into a temp sibling then atomically rename into place, so a
    // mid-copy failure never leaves a partial folder that a later boot would
    // treat as authoritative. On failure the temp dir is removed.
    const tmpDir = join(builtinRoot, `.${name}.tmp-${process.pid}`);
    try {
      await copyTree(seedDir, tmpDir);
      await rename(tmpDir, targetDir);
      cloned++;
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true });
      // A failed clone shouldn't take down startup — skip + report.
      console.error(
        `[seed] Failed to clone builtin tool folder '${name}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return cloned;
}

/** Recursively copy a directory tree (files + subdirectories). */
async function copyTree(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest);
    } else if (entry.isFile()) {
      if (copyFailureForTest === entry.name) {
        throw new Error(`[test] simulated copy failure for '${entry.name}'`);
      }
      await copyFile(src, dest);
    }
  }
}
