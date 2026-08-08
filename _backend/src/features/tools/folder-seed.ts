import { mkdir, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_TOOL_NAMES } from "./index";
import { seedsDir, seedSubdirForMode } from "../mds/paths";

let seedRootOverride: string | null | undefined;

/**
 * Override the seed root for tests (e.g. a temp dir with a partial
 * `builtin-tools/` tree). Passing null simulates a compiled binary with no
 * bundled seeds. Pass nothing (undefined) to clear the override and fall back
 * to the repo seeds.
 */
export function setSeedRootForTest(root?: string | null): void {
  seedRootOverride = root;
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

    try {
      await copyTree(seedDir, targetDir);
      cloned++;
    } catch (err) {
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
      await copyFile(src, dest);
    }
  }
}
