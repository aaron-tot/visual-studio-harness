/**
 * Workspace file watcher entry point.
 *
 * Delegates to the native @parcel/watcher backend when available, and falls
 * back to the pure-JS implementation if the native addon cannot be loaded
 * (e.g. inside a single-file compiled Bun binary where the `.node` addon is
 * not bundled). Backend choice is logged so it is easy to tell which path is
 * active.
 *
 * Selection order:
 *   1. `VSH_WATCH_BACKEND=js` → force the pure-JS backend.
 *   2. `@parcel/watcher` loaded and subscribable → native backend.
 *   3. otherwise → pure-JS backend.
 */
import type { WorkspaceWatcherInput, WorkspaceWatcherHandle } from "./types";
import { readWatchBackend, watchDisabled } from "./config";
export type { WorkspaceWatcherInput, WorkspaceWatcherHandle } from "./types";
export { startJavaScriptWatcher } from "./js-watcher";
export { isParcelAvailable, startParcelWatcher } from "./parcel-watcher";
export { readWatchBackend, watchDisabled } from "./config";

let parcelProbe: boolean | null = null;

async function parcelIsUsable(): Promise<boolean> {
  if (parcelProbe !== null) return parcelProbe;
  try {
    const { isParcelAvailable } = await import("./parcel-watcher");
    parcelProbe = await isParcelAvailable();
  } catch {
    parcelProbe = false;
  }
  return parcelProbe;
}

export async function startWorkspaceWatcher(
  input: WorkspaceWatcherInput
): Promise<WorkspaceWatcherHandle> {
  if (watchDisabled()) {
    console.log("[workspace-graph] watcher disabled via VSH_WATCH_DISABLED — no live watching");
    // Return a no-op handle so callers that `await startWorkspaceWatcher()` and
    // call `close()` on the result still behave correctly.
    let closed = false;
    return {
      backend: "js",
      async close() {
        closed = true;
      },
    };
  }

  // Prefer the native backend unless explicitly forced off.
  if (readWatchBackend() !== "js" && (await parcelIsUsable())) {
    try {
      const { startParcelWatcher } = await import("./parcel-watcher");
      const handle = await startParcelWatcher(input);
      return handle;
    } catch (err) {
      console.warn(
        "[workspace-graph] @parcel/watcher failed to start (" +
          (err as Error)?.message +
          "). Falling back to pure-JS watcher."
      );
    }
  }

  const { startJavaScriptWatcher } = await import("./js-watcher");
  return startJavaScriptWatcher(input);
}
