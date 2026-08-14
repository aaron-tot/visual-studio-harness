import { DEFAULT_UPDATE_REPO } from "../../../../_shared/types/config";
import { loadUpdates, saveUpdates } from "./store";
import type { ConfigFile, UpdateState } from "../../../../_shared/types";
import { broadcastToAll } from "../../ws/configPush";

const GITHUB_API = "https://api.github.com";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

interface GithubCompareResponse {
  status?: string;
  ahead_by?: number;
  commits?: Array<{ sha: string }>;
}

/**
 * Check the configured GitHub repo's main branch against the baked build commit.
 *
 * - Prod-only: never runs (and never persists) in dev.
 * - Once-per-day: skipped unless `force` (manual "Check for updates" click).
 * - Day is keyed to the last *successful* check (`lastChecked`); failures keep it
 *   unchanged so the next startup / manual click retries.
 * - Derives `commitsBehind` from the compare API; `available = commitsBehind > 0`.
 */
export async function checkForUpdates(opts: {
  dataDir: string;
  config: ConfigFile;
  mode: string;
  force?: boolean;
  /** Test seam — overrides the baked BUILD_COMMIT. */
  buildCommit?: string;
}): Promise<UpdateState> {
  const state = await loadUpdates(opts.dataDir);

  if (opts.mode !== "prod") {
    return state;
  }

  if (!opts.force && state.lastChecked && state.lastChecked.slice(0, 10) === todayUtc()) {
    return state;
  }

  const repo = opts.config.updatesRepo ?? DEFAULT_UPDATE_REPO;
  const buildCommit = opts.buildCommit ?? state.buildCommit;

  if (!buildCommit) {
    const next: UpdateState = {
      ...state,
      lastError: "Build commit unknown — this binary has no baked commit.",
    };
    await persistAndBroadcast(opts.dataDir, next);
    return next;
  }

  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}` +
    `/compare/${encodeURIComponent(buildCommit)}...main`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "visual-studio-harness-update-check",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API responded with ${res.status}`);
    }
    const data = (await res.json()) as GithubCompareResponse;
    const aheadBy = typeof data.ahead_by === "number" ? data.ahead_by : 0;
    const commits = data.commits ?? [];
    const latestCommit = aheadBy > 0 && commits.length > 0 ? commits[commits.length - 1].sha : buildCommit;

    const next: UpdateState = {
      lastChecked: new Date().toISOString(),
      available: aheadBy > 0,
      buildCommit,
      latestCommit,
      commitsBehind: Math.max(0, aheadBy),
      lastError: null,
    };
    await persistAndBroadcast(opts.dataDir, next);
    return next;
  } catch (err) {
    const next: UpdateState = {
      ...state,
      lastError: err instanceof Error ? err.message : String(err),
    };
    await persistAndBroadcast(opts.dataDir, next);
    return next;
  }
}

async function persistAndBroadcast(dataDir: string, next: UpdateState): Promise<void> {
  await saveUpdates(dataDir, next).catch(() => {});
  broadcastToAll({ type: "updates_updated", updates: next });
  console.log(
    `[updates] ${next.available ? `update available (${next.commitsBehind} behind)` : "up to date"}` +
    (next.lastError ? ` — error: ${next.lastError}` : "")
  );
}
