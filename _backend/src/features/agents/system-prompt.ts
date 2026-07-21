import { mkdir, readFile, copyFile, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import type { Message } from "../../../_shared/types";
import { atomicWriteFile } from "../tools/host/atomic-write";
import { buildDefaultGlobalAgentsMarkdown } from "./agents.default";
import { globalAgentsPath, legacyGlobalAgentsPath, seedsDir, seedSubdirForMode } from "./paths";
import { readAgentsFile } from "./md-utils";

export { AGENTS_MD_NAMES, DEFAULT_SYSTEM_PROMPT_JOINERS } from "./constants";
export type { BuildSystemBlockInput } from "./constants";
export { globalAgentsPath, projectAgentsPath, loadSeedJoinersDefaults } from "./paths";
export { listAgentsMdAtRoot, readAgentsFile, resolveAgentMd, resolveSkillMds } from "./md-utils";
export { formatRuntimeInfo } from "./format";
export { formatTodoList } from "./todo-list-format";
export { buildSystemBlock } from "./build-block";

async function fileExists(path: string): Promise<boolean> {
  try { await import("node:fs/promises").then(fs => fs.access(path)); return true; } catch { return false; }
}

export async function ensureGlobalAgentsFile(dataDir: string, mode = "dev"): Promise<void> {
  const path = globalAgentsPath(dataDir);
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
    await atomicWriteFile(path, buildDefaultGlobalAgentsMarkdown());
  } catch (err) {
    console.warn(`[system-prompt] failed to create global prompt at ${path}:`, err instanceof Error ? err.message : err);
  }
}

export function messagesForModel(sessionMessages: Message[], systemBlock: string): Message[] {
  const history = sessionMessages.filter((m) => m.role !== "system");
  const content = systemBlock.trim();
  if (!content) return [...history];
  return [{ role: "system", content, timestamp: new Date().toISOString() }, ...history];
}

export function assertExactlyOneSystemMessage(messages: Message[]): void {
  const systemIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "system") systemIndexes.push(i);
  }
  if (systemIndexes.length > 1) throw new Error(`system prompt must appear exactly once before LLM call (found ${systemIndexes.length})`);
  if (systemIndexes.length === 1) {
    if (systemIndexes[0] !== 0) throw new Error(`system prompt must be the first message before LLM call (found at index ${systemIndexes[0]})`);
    const content = messages[0]?.content?.trim() ?? "";
    if (!content) throw new Error("system prompt message is empty");
  }
}
