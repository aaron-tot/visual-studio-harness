import { watch } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createDebounceQueue, type DebounceQueue } from "./debounce-queue";
import { fsEventTypeFromRaw, type WorkspaceFsEvent } from "./events";

export interface WorkspaceWatcherInput {
  workspaceRoot: string;
  debounceMs?: number;
  onBatch: (events: WorkspaceFsEvent[]) => Promise<void>;
}

export interface WorkspaceWatcherHandle {
  close(): Promise<void>;
}

export async function startWorkspaceWatcher(
  input: WorkspaceWatcherInput
): Promise<WorkspaceWatcherHandle> {
  const {
    workspaceRoot,
    debounceMs = 50,
    onBatch,
  } = input;

  const resolvedRoot = resolve(workspaceRoot);
  const abortController = new AbortController();

  const commonDirs = [".vsh", "node_modules", ".git", "dist", "build", "coverage", ".turbo"];

  function isIgnored(relPath: string): boolean {
    const parts = relPath.split("/");
    return commonDirs.some((d) => parts.includes(d));
  }

  const queue = createDebounceQueue(debounceMs, onBatch);

  // start watching
  const watcher = watch(resolvedRoot, {
    recursive: true,
    signal: abortController.signal,
  });

  // Process events in background
  ;(async () => {
    try {
      for await (const event of watcher) {
        const { eventType, filename } = event;
        if (!filename) continue;

        const fullPath = join(resolvedRoot, filename.toString());
        const relPath = relative(resolvedRoot, fullPath);

        if (isIgnored(relPath)) continue;

        queue.push({
          type: fsEventTypeFromRaw(eventType),
          path: relPath,
          timestampMs: Date.now(),
        });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[workspace-graph] watcher error:", err);
      }
    }
  })();

  return {
    async close() {
      queue.close();
      abortController.abort();
    },
  };
}
