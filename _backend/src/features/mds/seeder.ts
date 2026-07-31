import { mkdir, readFile, copyFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicWriteFile } from "../tools/host/atomic-write";
import { buildDefaultGlobalSystemPrompt } from "./defaults";
import { globalSystemPromptPath, legacyGlobalAgentsPath, seedsDir, seedSubdirForMode } from "./paths";
import { readAgentsFile } from "./reader";

async function fileExists(path: string): Promise<boolean> {
  try { await import("node:fs/promises").then(fs => fs.access(path)); return true; } catch { return false; }
}

export async function ensureGlobalSystemPromptFile(dataDir: string, mode = "dev"): Promise<void> {
  const path = globalSystemPromptPath(dataDir);
  if (await fileExists(path)) return;

  // Migration from legacy path (mds/global/agents.md)
  const legacyPath = legacyGlobalAgentsPath(dataDir);
  if (await fileExists(legacyPath)) {
    try {
      const content = await readFile(legacyPath, "utf-8");
      const mdsDir = join(resolve(dataDir), "mds");
      await mkdir(mdsDir, { recursive: true });
      await atomicWriteFile(path, content);
      return;
    } catch (err) {
      console.warn(`[system-prompt] failed to migrate legacy agents.md:`, err instanceof Error ? err.message : err);
    }
  }

  // Seed from repoSource/seeds/{modeSubdir}/mds/systemPromptBase.md
  const sDir = seedsDir();
  if (sDir) {
    const seedPath = resolve(sDir, seedSubdirForMode(mode), "mds", "systemPromptBase.md");
    try {
      await access(seedPath);
      const mdsDir = join(resolve(dataDir), "mds");
      await mkdir(mdsDir, { recursive: true });
      await copyFile(seedPath, path);
      console.log(`[system-prompt] seeded global prompt from ${seedPath}`);
      return;
    } catch {
      // fall through to built-in defaults
    }
  }

  // Fallback to built-in defaults
  try {
    const mdsDir = join(resolve(dataDir), "mds");
    await mkdir(mdsDir, { recursive: true });
    await atomicWriteFile(path, buildDefaultGlobalSystemPrompt());
  } catch (err) {
    console.warn(`[system-prompt] failed to create global prompt at ${path}:`, err instanceof Error ? err.message : err);
  }
}
