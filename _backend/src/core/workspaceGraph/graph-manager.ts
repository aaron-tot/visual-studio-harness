import { createWorkspaceGraphService } from ".";
import type { WorkspaceGraphService } from "./api/types";

export interface ManagedGraph {
  service: WorkspaceGraphService;
  watcherEnabled: boolean;
}

export class WorkspaceGraphManager {
  private _graphs = new Map<string, ManagedGraph>();

  get(workspaceRoot: string): WorkspaceGraphService | null {
    const normalized = resolveWorkspaceKey(workspaceRoot);
    return this._graphs.get(normalized)?.service ?? null;
  }

  getFirstWorkspace(): WorkspaceGraphService | null {
    return this._graphs.values().next().value?.service ?? null;
  }

  async initializeForWorkspace(
    workspaceRoot: string,
    opts?: { enableWatcher?: boolean }
  ): Promise<void> {
    const key = resolveWorkspaceKey(workspaceRoot);
    if (this._graphs.has(key)) return;
    const service = await createWorkspaceGraphService({
      workspaceRoot,
      enableWatcher: opts?.enableWatcher ?? false,
    });
    const watcherEnabled = opts?.enableWatcher ?? false;
    await service.start();
    this._graphs.set(key, { service, watcherEnabled });
  }

  async initializeFromSessions(
    workspaceRoots: string[],
    opts?: { enableWatcher?: boolean }
  ): Promise<void> {
    const unique = [...new Set(workspaceRoots.map(resolveWorkspaceKey))];
    await Promise.all(
      unique.map((root) =>
        this.initializeForWorkspace(root, opts).catch((err) => {
          console.error(`[workspace-graph] failed to init for ${root}:`, err);
        })
      )
    );
  }

  async stop(workspaceRoot: string): Promise<void> {
    const key = resolveWorkspaceKey(workspaceRoot);
    const entry = this._graphs.get(key);
    if (!entry) return;
    try {
      await entry.service.stop();
    } finally {
      this._graphs.delete(key);
    }
  }

  stopAll(): Promise<void> {
    return Promise.all(
      Array.from(this._graphs.values()).map((e) => e.service.stop())
    ).then(() => { this._graphs.clear(); });
  }

  get activeWorkspaceRoots(): string[] {
    return Array.from(this._graphs.keys());
  }
}

function resolveWorkspaceKey(workspaceRoot: string): string {
  return workspaceRoot.replace(/[/\\]+$/, "");
}
