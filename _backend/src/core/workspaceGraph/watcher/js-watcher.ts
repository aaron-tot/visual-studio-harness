/**
 * Pure-JS file watcher (fallback backend).
 *
 * Usable in any environment — including single-file compiled Bun binaries,
 * where the @parcel/watcher native `.node` addon is not bundled. It keeps the
 * same robust behavior as the original implementation:
 *
 *   - Linux: per-directory inotify watches with ignore filtering at
 *     registration time (ignored dirs are never descended into, so they cost no
 *     watch). New directories are discovered dynamically. Bounded by a watch
 *     cap and graceful ENOSPC/EMFILE degradation so the user's inotify budget
 *     is never exhausted.
 *   - macOS/Windows: a single recursive watch → O(1) descriptors; ignore is
 *     applied in the callback (the only option on those platforms).
 */
import { watch as fsWatch, readdirSync, statSync, existsSync, type FSWatcher } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import { createDebounceQueue } from "./debounce-queue";
import type { WorkspaceFsEvent } from "./events";
import type { WorkspaceWatcherInput, WorkspaceWatcherHandle } from "./types";
import { readMaxDirWatches, readDebounceMs, resolveIgnoredDirs } from "./config";

function classifyEvent(fullPath: string, rawEventType: string): WorkspaceFsEvent["type"] | null {
  // `change` always means a file was modified.
  if (rawEventType === "change" || rawEventType === "update") return "change";

  // `rename` (and friends) maps to create/delete depending on existence.
  const exists = existsSync(fullPath);
  if (exists) {
    try {
      return statSync(fullPath).isDirectory() ? "addDir" : "add";
    } catch {
      return "add";
    }
  }
  return "unlink";
}

function makeEvent(fullPath: string, rawType: string, root: string): WorkspaceFsEvent | null {
  const type = classifyEvent(fullPath, rawType);
  if (!type) return null;
  return { type, path: relative(root, fullPath), timestampMs: Date.now() };
}

export async function startJavaScriptWatcher(
  input: WorkspaceWatcherInput
): Promise<WorkspaceWatcherHandle> {
  const workspaceRoot = input.workspaceRoot;
  const debounceMs = input.debounceMs ?? readDebounceMs();
  const onBatch = input.onBatch;
  const maxDirWatches = input.maxDirWatches ?? readMaxDirWatches();
  const ignoreDirs = new Set(resolveIgnoredDirs(input.ignoreDirs));

  const resolvedRoot = resolve(workspaceRoot);
  const queue = createDebounceQueue(debounceMs, onBatch);
  let closed = false;

  function isIgnoredRelPath(relPath: string): boolean {
    if (!relPath) return false;
    return relPath.split("/").some((seg) => seg && ignoreDirs.has(seg));
  }

  const isLinux = process.platform === "linux";

  // —————————————————————————————————————————————————————————————
  // macOS / Windows: a single recursive watch → O(1) descriptors.
  // FSEvents / ReadDirectoryChangesW cover the whole tree; ignore is applied
  // in the callback (that is the only option on these platforms).
  // —————————————————————————————————————————————————————————————
  if (!isLinux) {
    const abort = new AbortController();
    const watcher: FSWatcher = fsWatch(
      resolvedRoot,
      { recursive: true, signal: abort.signal },
      (rawType, filename) => {
        if (closed || filename == null) return;
        const fullPath = join(resolvedRoot, filename.toString());
        const relPath = relative(resolvedRoot, fullPath);
        if (isIgnoredRelPath(relPath)) return;
        const ev = makeEvent(fullPath, rawType, resolvedRoot);
        if (ev) queue.push(ev);
      }
    );
    watcher.on("error", (err: NodeJS.ErrnoException) => {
      if (!closed) console.error("[workspace-graph] watcher error:", err?.message ?? err);
    });

    return {
      backend: "js",
      async close() {
        closed = true;
        queue.close();
        try {
          abort.abort();
        } catch {
          /* ignore */
        }
        await new Promise<void>((res) => {
          try {
            watcher.close();
          } catch {
            /* already closed */
          }
          res();
        });
      },
    };
  }

  // —————————————————————————————————————————————————————————————
  // Linux: per-directory inotify watches. Walk the (non-ignored) tree once and
  // register one `fs.watch(dir)` per surviving directory — O(dirs), never
  // O(files). Ignored dirs are not descended into (no watch created). New
  // directories are discovered dynamically. Bounded by a watch cap and graceful
  // ENOSPC degradation so we never exhaust the user's inotify budget.
  // —————————————————————————————————————————————————————————————
  const dirWatchers = new Map<string, FSWatcher>();
  let dirCapWarned = false;
  let inotifyLimitWarned = false;

  function warnInotifyLimit(): void {
    if (inotifyLimitWarned) return;
    inotifyLimitWarned = true;
    console.warn(
      "[workspace-graph] inotify watch limit hit (ENOSPC). Watched dirs: " +
        `${dirWatchers.size}. Raise fs.inotify.max_user_watches via sysctl, or reduce ` +
        "workspace size / ignore list. Existing watches keep working."
    );
  }

  function handles(err: NodeJS.ErrnoException): "inotify" | "fatal" | "skip" | null {
    if (!err) return null;
    if (err.code === "ENOSPC") return "inotify"; // inotify watch budget exhausted
    if (err.code === "EMFILE" || err.code === "ENFILE") return "fatal"; // process fd exhaustion
    return null; // ENOENT / EACCES on a single dir → skip quietly
  }

  function watchDir(dirAbs: string): void {
    if (closed || inotifyLimitWarned || dirWatchers.has(dirAbs)) return;
    if (dirWatchers.size >= maxDirWatches) {
      if (!dirCapWarned) {
        dirCapWarned = true;
        console.warn(
          `[workspace-graph] hit directory-watch cap (${maxDirWatches}). ` +
            "Remaining subtrees rely on manual/periodic reindex. Raise VSH_MAX_DIR_WATCHES to increase."
        );
      }
      return;
    }

    let w: FSWatcher;
    try {
      w = fsWatch(dirAbs, { persistent: true }, (rawType, filename) =>
        handleDirEvent(dirAbs, rawType, filename)
      );
    } catch (err) {
      switch (handles(err as NodeJS.ErrnoException)) {
        case "inotify":
          warnInotifyLimit();
          return;
        case "fatal":
          console.error("[workspace-graph] watcher fd exhaustion:", (err as Error).message);
          inotifyLimitWarned = true; // stop adding further watches
          return;
        default:
          return; // skip dir quietly
      }
    }

    w.on("error", (err: NodeJS.ErrnoException) => {
      const kind = handles(err);
      if (kind === "fatal") {
        console.error("[workspace-graph] watcher error:", err.message);
        dirWatchers.delete(dirAbs);
      } else if (kind === "inotify") {
        warnInotifyLimit();
        dirWatchers.delete(dirAbs);
      } else {
        dirWatchers.delete(dirAbs);
      }
    });

    dirWatchers.set(dirAbs, w);

    // Recurse into non-ignored subdirectories.
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !ignoreDirs.has(entry.name)) {
        watchDir(join(dirAbs, entry.name));
      }
    }
  }

  function handleDirEvent(dirAbs: string, rawType: string, filename: string | Buffer | null): void {
    if (closed || filename == null) return;
    const fullPath = join(dirAbs, filename.toString());

    // A newly-created directory needs its own watch. `stat` is cheap and these
    // events are rare relative to file edits.
    let isDirEntry = false;
    try {
      isDirEntry = statSync(fullPath).isDirectory();
    } catch {
      // deleted/inaccessible → fall through to event below
    }

    if (isDirEntry && !dirWatchers.has(fullPath)) {
      if (!ignoreDirs.has(basename(fullPath))) {
        watchDir(fullPath);
        // Emit addDir for non-ignored dirs; consumers ignore dir events but it's accurate.
        queue.push(makeEvent(fullPath, "rename", resolvedRoot)!);
      }
      return;
    }

    const relPath = relative(resolvedRoot, fullPath);
    if (isIgnoredRelPath(relPath)) return;
    const ev = makeEvent(fullPath, rawType, resolvedRoot);
    if (ev) queue.push(ev);
  }

  // Initial tree walk.
  watchDir(resolvedRoot);

  return {
    backend: "js",
    async close() {
      closed = true;
      queue.close();
      for (const w of dirWatchers.values()) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      dirWatchers.clear();
    },
  };
}
