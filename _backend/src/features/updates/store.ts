import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { BUILD_COMMIT } from "../../../../_shared/build-info";
import type { UpdateState } from "../../../../_shared/types";

/**
 * Persistence for update-check runtime state.
 *
 * Stored separately from config.json (data/{mode}/updates.json) on purpose:
 * writing every daily check into config would cascade a full config fs.watch
 * reload + MCP reconfigure. This file only changes when a check completes.
 * Last *successful* check wins; failures leave lastChecked untouched so the
 * next startup / manual click retries.
 */

export function defaultUpdateState(): UpdateState {
  return {
    lastChecked: null,
    available: false,
    buildCommit: BUILD_COMMIT,
    latestCommit: null,
    commitsBehind: 0,
    lastError: null,
  };
}

function updatesPath(dataDir: string): string {
  return join(dataDir, "updates.json");
}

export async function loadUpdates(dataDir: string): Promise<UpdateState> {
  const fallback = defaultUpdateState();
  try {
    const raw = await readFile(updatesPath(dataDir), "utf-8");
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    return { ...fallback, ...parsed, buildCommit: BUILD_COMMIT };
  } catch {
    return fallback;
  }
}

export async function saveUpdates(dataDir: string, state: UpdateState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(updatesPath(dataDir), JSON.stringify(state, null, 2) + "\n", "utf-8");
}
