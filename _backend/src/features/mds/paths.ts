import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { SystemPromptJoiners } from "../../../_shared/types";
import { AGENTS_MD_NAMES } from "./constants";

export function globalAgentsPath(dataDir: string): string {
  return join(resolve(dataDir), "mds", "systemPromptBase.md");
}

/** Legacy path used prior to the switch to systemPromptBase.md — kept for migration. */
export function legacyGlobalAgentsPath(dataDir: string): string {
  return join(resolve(dataDir), "mds", "global", "agents.md");
}

export function seedSubdirForMode(mode: string): string {
  if (mode === "dev") return "dev";
  return "packageAndProd";
}

export function seedsDir(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.dir && !import.meta.dir.includes("$bunfs")) {
    // features/mds/paths.ts → ../../../seeds
    return resolve(import.meta.dir, "../../../seeds");
  }
  return null;
}

export function projectAgentsPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), AGENTS_MD_NAMES[0]);
}

/** Returns the `.agentHarness/mds/` directory under workspace root (scoped project MDs). */
export function projectScopedMdsDir(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".agentHarness", "mds");
}

export function seedConfigPath(mode: string): string | null {
  const sDir = seedsDir();
  if (!sDir) return null;
  return resolve(sDir, seedSubdirForMode(mode), "config.json");
}

export function seedJoinersDefaultsPath(mode: string): string | null {
  const sDir = seedsDir();
  if (!sDir) return null;
  return resolve(sDir, seedSubdirForMode(mode), "config", "joinerDefaults.json");
}

export async function loadSeedJoinersDefaults(mode: string): Promise<SystemPromptJoiners | null> {
  const p = seedJoinersDefaultsPath(mode);
  if (!p) return null;
  try {
    const raw = await readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      start: parsed.start ?? "",
      preGlobal: parsed.preGlobal ?? "<global>",
      postGlobal: parsed.postGlobal ?? "</global>",
      preAgent: parsed.preAgent ?? "<agent>",
      postAgent: parsed.postAgent ?? "</agent>",
      preSkills: parsed.preSkills ?? "<skills>",
      postSkills: parsed.postSkills ?? "</skills>",
      preProject: parsed.preProject ?? "<project>",
      postProject: parsed.postProject ?? "</project>",
      preRuntime: parsed.preRuntime ?? "<runtime>",
      postRuntime: parsed.postRuntime ?? "</runtime>",
      preTodoList: parsed.preTodoList ?? "<todoList>",
      postTodoList: parsed.postTodoList ?? "</todoList>",
      preWorkspaceManifest: parsed.preWorkspaceManifest ?? "<workspaceManifest>",
      postWorkspaceManifest: parsed.postWorkspaceManifest ?? "</workspaceManifest>",
      preExtras: parsed.preExtras ?? "<extras>",
      postExtras: parsed.postExtras ?? "</extras>",
      end: parsed.end ?? "",
    };
  } catch {
    return null;
  }
}
