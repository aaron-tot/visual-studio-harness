import type { FastifyInstance } from "fastify";
import type { ConfigFile } from "../../../../_shared/types";
import { DEFAULT_UPDATE_REPO } from "../../../../_shared/types/config";
import { BUILD_COMMIT } from "../../../../_shared/build-info";
import { checkForUpdates } from "./check";
import { loadUpdates } from "./store";

function repoUrl(config: ConfigFile): string {
  const repo = config.updatesRepo ?? DEFAULT_UPDATE_REPO;
  return `https://github.com/${repo.owner}/${repo.name}`;
}

export function registerUpdatesRoutes(
  app: FastifyInstance,
  dataDir: string,
  mode: string,
  getConfig: () => ConfigFile
) {
  app.get("/api/updates", async () => {
    const config = getConfig();
    return {
      appCommit: BUILD_COMMIT,
      repoUrl: repoUrl(config),
      updates: await loadUpdates(dataDir),
    };
  });

  // Manual check — always bypasses the once-per-day skip. No-ops (returns cached
  // state) in dev.
  app.post("/api/updates/check", async () => {
    const config = getConfig();
    const updates = await checkForUpdates({ dataDir, config, mode, force: true });
    return {
      appCommit: BUILD_COMMIT,
      repoUrl: repoUrl(config),
      updates,
    };
  });
}
