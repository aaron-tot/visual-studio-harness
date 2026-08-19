import type { WorkspaceFsEvent } from "./events";

/**
 * Shared input contract for both watcher backends. Note: `dirWatchers` here
 * never grows with ignored dirs (the pure-JS backend prunes at registration
 * time; the native backend prunes in its own layer).
 */
export interface WorkspaceWatcherInput {
  workspaceRoot: string;
  debounceMs?: number;
  /**
   * Directory names to ignore, matched on ANY path segment (so `node_modules`
   * ignores `<root>/node_modules/...` and `<root>/src/vendor/node_modules/...`).
   * Defaults to the shared DEFAULT_IGNORED_DIRS. Overridden by the
   * `VSH_WATCH_IGNORE_DIRS` env var when present.
   */
  ignoreDirs?: string[];
  /**
   * Max directories to watch on the per-directory (Linux/fallback) backend.
   * Defaults to env `VSH_MAX_DIR_WATCHES` or 50_000.
   */
  maxDirWatches?: number;
  onBatch: (events: WorkspaceFsEvent[]) => Promise<void>;
}

/**
 * Shared handle returned by the watcher. `close()` stops all watching.
 * `querySince` is available on the native (@parcel/watcher) backend so callers
 * can cheaply reconstruct changes that happened while the watcher was offline;
 * the pure-JS fallback does not implement it (returns an empty list).
 */
export interface WorkspaceWatcherHandle {
  close(): Promise<void>;
  readonly backend: "parcel" | "js";
}
