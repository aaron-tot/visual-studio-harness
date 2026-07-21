import { existsSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string | null>();

const SEARCH_PATHS = [
  "/usr/bin",
  "/usr/local/bin",
  "/bin",
  process.env.HOME ? join(process.env.HOME, ".local", "bin") : "",
  ...(process.env.PATH?.split(":") ?? []),
].filter(Boolean);

/** Resolve first available binary name (e.g. fd vs fdfind). Cached. */
export function which(names: string | string[]): string | null {
  const list = Array.isArray(names) ? names : [names];
  const key = list.join("|");
  if (cache.has(key)) return cache.get(key)!;

  for (const name of list) {
    if (name.includes("/")) {
      if (existsSync(name)) {
        cache.set(key, name);
        return name;
      }
      continue;
    }
    for (const dir of SEARCH_PATHS) {
      const full = join(dir, name);
      if (existsSync(full)) {
        cache.set(key, full);
        return full;
      }
    }
  }
  cache.set(key, null);
  return null;
}

export function requireBinary(names: string | string[], installHint: string): string {
  const found = which(names);
  if (!found) {
    throw new Error(`ERROR host: binary not found (${Array.isArray(names) ? names.join("/") : names}). ${installHint}`);
  }
  return found;
}
