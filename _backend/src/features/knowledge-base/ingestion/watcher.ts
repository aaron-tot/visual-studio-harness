import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEBOUNCE_WINDOW_MS } from "../constants";

const IGNORE_PATTERNS = [
  /^\./,       // dotfiles
  /\.swp$/,    // vim swap
  /~$/,        // emacs backup
  /\.bak$/i,   // generic backup
];

/**
 * Start watching a sources directory for changes.
 * Debounces events at 1000ms.
 * Returns the FSWatcher for cleanup.
 */
export function startWatcher(
  sourcesDir: string,
  onChange: () => void,
): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function debouncedOnChange() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange();
      } catch (err) {
        console.error("[knowledge] watcher onChange error:", err);
      }
    }, DEBOUNCE_WINDOW_MS);
  }

  if (!existsSync(sourcesDir)) {
    // Directory doesn't exist yet — return a no-op watcher
    return {
      close: () => {},
    } as FSWatcher;
  }

  const watcher = watch(sourcesDir, (eventType, filename) => {
    if (!filename) return;
    if (IGNORE_PATTERNS.some((p) => p.test(filename))) return;

    // On rename: check if file still exists → determine ADD vs DELETE
    const filepath = join(sourcesDir, filename);
    if (eventType === "rename") {
      if (!existsSync(filepath)) {
        // File was deleted
        debouncedOnChange();
        return;
      }
    }

    debouncedOnChange();
  });

  return watcher;
}
