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

/**
 * Maps runtime mode string to the seed subdirectory name under repoSource/seeds/.
 *
 * seeds/dev/           → mode "dev"
 * seeds/packageAndProd/ → modes "prod" and "package"
 */
export function seedSubdirForMode(mode: string): string {
  if (mode === "dev") return "dev";
  return "packageAndProd";
}

/**
 * Resolves the canonical seeds directory root (repoSource/seeds/).
 * Returns null when running from a compiled binary that has no source tree.
 *
 * The caller should handle null gracefully — fall through to built-in defaults.
 */
export function seedsDir(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.dir && !import.meta.dir.includes("$bunfs")) {
    // _backend/src/features/agents/paths.ts → ../../../../seeds
    return resolve(import.meta.dir, "../../../../seeds");
  }
  return null;
}

export function projectAgentsPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), AGENTS_MD_NAMES[0]);
}

/**
 * Resolves the seed config.json path for a given mode.
 * Returns null when there is no seed directory (compiled binary).
 *
 * seeds/{subdir}/config.json
 */
export function seedConfigPath(mode: string): string | null {
  const sDir = seedsDir();
  if (!sDir) return null;
  return resolve(sDir, seedSubdirForMode(mode), "config.json");
}

/**
 * Resolves the seed joiner-defaults file path for a given mode.
 *
 * seeds/{subdir}/config/joinerDefaults.json
 */
export function seedJoinersDefaultsPath(mode: string): string | null {
  const sDir = seedsDir();
  if (!sDir) return null;
  return resolve(sDir, seedSubdirForMode(mode), "config", "joinerDefaults.json");
}

/**
 * Reads the seed joinerDefaults.json for a given mode and returns parsed SystemPromptJoiners.
 * Returns null when the seed file is missing, unavailable, or unparseable.
 */
export async function loadSeedJoinersDefaults(mode: string): Promise<SystemPromptJoiners | null> {
  const p = seedJoinersDefaultsPath(mode);
  if (!p) return null;
  try {
    const raw = await readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      start: parsed.start ?? "",
      afterGlobal: parsed.afterGlobal ?? "\n\n",
      afterAgentMd: parsed.afterAgentMd ?? "\n\n",
      afterSkillMds: parsed.afterSkillMds ?? "\n\n",
      afterProject: parsed.afterProject ?? "\n\n",
      afterRuntime: parsed.afterRuntime ?? "\n\n",
      afterTodoList: parsed.afterTodoList ?? "\n\n",
      afterExtras: parsed.afterExtras ?? "\n\n",
      end: parsed.end ?? "",
    };
  } catch {
    return null;
  }
}
