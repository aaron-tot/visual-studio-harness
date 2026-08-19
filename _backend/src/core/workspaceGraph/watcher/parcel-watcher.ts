/**
 * Native file watcher backed by @parcel/watcher (N-API/C++).
 *
 * Benefits over the pure-JS fallback:
 *   - Ignore glob patterns are applied in the native layer, so ignored
 *     directories never consume a kernel watch and their events are never
 *     delivered to JS.
 *   - Events are coalesced/throttled on a background thread (great for
 *     `git checkout` / `npm install` storms).
 *   - Uses Watchman automatically when installed (shared daemon, no re-crawl
 *     on restart).
 *
 * The native `.node` addon is NOT bundled into single-file compiled Bun
 * binaries, so this module must be imported lazily and guarded: if the addon
 * is unavailable (e.g. prod binary), the caller falls back to the pure-JS
 * watcher instead of crashing. Verified working under Bun dev (1.3.x).
 */
import { relative, resolve } from "node:path";
import { createDebounceQueue } from "./debounce-queue";
import type { WorkspaceFsEvent } from "./events";
import type { WorkspaceWatcherInput, WorkspaceWatcherHandle } from "./types";
import { readDebounceMs, resolveIgnoredDirs, ignoredDirsToGlobs } from "./config";

type ParcelEventType = "create" | "update" | "delete";
interface ParcelEvent {
  type: ParcelEventType;
  path: string;
}
interface ParcelSubscription {
  unsubscribe(): Promise<void>;
}
type ParcelModule = {
  subscribe(
    dir: string,
    callback: (error: Error | undefined | null, events: ParcelEvent[]) => void,
    opts?: Record<string, unknown>
  ): Promise<ParcelSubscription>;
};

let parcelModule: ParcelModule | null | undefined;

async function loadParcel(): Promise<ParcelModule | null> {
  if (parcelModule !== undefined) return parcelModule;
  try {
    const mod = (await import("@parcel/watcher")) as unknown;
    const m = mod as ParcelModule;
    if (typeof m.subscribe === "function") {
      parcelModule = m;
    } else {
      parcelModule = null;
    }
  } catch {
    parcelModule = null;
  }
  return parcelModule;
}

export async function isParcelAvailable(): Promise<boolean> {
  return (await loadParcel()) !== null;
}

function mapEvent(ev: ParcelEvent, root: string): WorkspaceFsEvent {
  const type: WorkspaceFsEvent["type"] =
    ev.type === "create" ? "add" : ev.type === "update" ? "change" : "unlink";
  return { type, path: relative(root, ev.path), timestampMs: Date.now() };
}

export async function startParcelWatcher(
  input: WorkspaceWatcherInput
): Promise<WorkspaceWatcherHandle> {
  const parcel = await loadParcel();
  if (!parcel) throw new Error("[workspace-graph] @parcel/watcher unavailable");

  const workspaceRoot = input.workspaceRoot;
  const debounceMs = input.debounceMs ?? readDebounceMs();
  const onBatch = input.onBatch;
  const ignoredDirs = resolveIgnoredDirs(input.ignoreDirs);
  const ignoreGlobs = ignoredDirsToGlobs(ignoredDirs);

  const resolvedRoot = resolve(workspaceRoot);
  const queue = createDebounceQueue(debounceMs, onBatch);
  let closed = false;

  const subscription = await parcel.subscribe(
    resolvedRoot,
    (error, events) => {
      if (closed) return;
      if (error) {
        console.error("[workspace-graph] parcel watcher error:", error.message);
        return;
      }
      for (const ev of events) queue.push(mapEvent(ev, resolvedRoot));
    },
    { ignore: ignoreGlobs }
  );

  return {
    backend: "parcel",
    async close() {
      if (closed) return;
      closed = true;
      queue.close();
      try {
        await subscription.unsubscribe();
      } catch {
        /* already closed */
      }
    },
  };
}
