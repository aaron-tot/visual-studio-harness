import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { SystemPromptJoiners } from "../../../_shared/types";
import { AGENTS_MD_NAMES } from "./constants";

/** Path to the global system prompt base file inside the _SystemBase container (V2 layout). */
export function globalSystemPromptPath(dataDir: string): string {
  return join(resolve(dataDir), "mds", "_SystemBase", "systemPromptBase", "prompt.md");
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

/** Path to the workspace root's AGENTS.md file (project-level agent instructions). */
export function projectAgentsMdPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), AGENTS_MD_NAMES[0]);
}

/** Returns the `.agentHarness/mds/` directory under workspace root (scoped project MDs). */
export function projectScopedMdsDir(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".agentHarness", "mds");
}

export type MdsScope = "global" | "project" | "session";

/** Resolve the MDS directory for a scope. Returns null when the scope can't be resolved (no workspace / no session). */
export function resolveMdsScopeDir(
  scope: MdsScope,
  dataDir: string,
  workspaceRoot?: string,
  sessionId?: string
): string | null {
  switch (scope) {
    case "project":
      if (!workspaceRoot) return null;
      return projectScopedMdsDir(workspaceRoot);
    case "session":
      if (!sessionId) return null;
      return join(dataDir, "session", sessionId, "mds");
    default:
      return join(dataDir, "mds");
  }
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
