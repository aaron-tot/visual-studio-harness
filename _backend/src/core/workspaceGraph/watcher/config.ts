/**
 * Shared file-watcher configuration and helpers used by both the native
 * (@parcel/watcher) and pure-JS fallback backends.
 *
 * Ignored directories are expressed to users the same way as before (a bare
 * directory name matched on any path segment), so the name "node_modules"
 * ignores it at any depth under the root. The native backend additionally
 * needs these translated to glob patterns (double-asterisk-slash + name +
 * double-asterisk-slash + name) because that is what it understands natively.
 */

/** Default directories never watched, regardless of user config. */
export const DEFAULT_IGNORED_DIRS = [
  ".vsh",
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  ".vercel",
  "target",
  "vendor",
  "__pycache__",
  ".pytest_cache",
  ".codegraph",
] as const;

/** Max directories watched on the per-directory (Linux/fallback) backend. */
export const DEFAULT_MAX_DIR_WATCHES = 50_000;
/** Default event batching window (ms). */
export const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Backends available. `"native"` tries @parcel/watcher first then falls back
 * to the pure-JS backend; `"js"` forces the pure-JS backend (useful in
 * single-file compiled binaries where the native addon is not bundled).
 */
export type WatchBackend = "native" | "js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return fallback;
}

/** Resolve max directory watches from env or default. */
export function readMaxDirWatches(): number {
  return envInt("VSH_MAX_DIR_WATCHES", DEFAULT_MAX_DIR_WATCHES);
}

/** Resolve debounce window (ms) from env or default. */
export function readDebounceMs(): number {
  return envInt("VSH_WATCH_DEBOUNCE_MS", DEFAULT_DEBOUNCE_MS);
}

/** Resolve backend selection from env (`VSH_WATCH_BACKEND` = `native` | `js`). */
export function readWatchBackend(): WatchBackend {
  const raw = process.env.VSH_WATCH_BACKEND;
  return raw === "js" ? "js" : "native";
}

/** Resolve ignore global-disable flag. */
export function watchDisabled(): boolean {
  return process.env.VSH_WATCH_DISABLED === "1" || process.env.VSH_WATCH_DISABLED === "true";
}

/**
 * Build the effective list of ignored directory names.
 * `VSH_WATCH_IGNORE_DIRS` (comma-separated) replaces the defaults entirely; an
 * empty value keeps the defaults. User-supplied names are trimmed of slashes.
 */
export function resolveIgnoredDirs(userDirs: string[] | undefined): string[] {
  const envRaw = process.env.VSH_WATCH_IGNORE_DIRS;
  const names = envRaw !== undefined && envRaw !== "" ? envRaw.split(",") : userDirs;
  const source = names && names.length > 0 ? names : [...DEFAULT_IGNORED_DIRS];
  return source.map((d) => String(d).trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}

/**
 * Translate a set of ignored directory names into @parcel/watcher glob
 * patterns. Each dir matches itself (a dir whose own name is ignored) and
 * everything under it at any depth.
 */
export function ignoredDirsToGlobs(ignoredDirs: string[]): string[] {
  const globs: string[] = [];
  for (const dir of ignoredDirs) {
    globs.push(`**/${dir}`, `**/${dir}/**`);
  }
  return globs;
}
