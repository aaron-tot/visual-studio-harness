import type { FastifyInstance } from "fastify";
import { readdir, stat } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/**
 * Local folder browser for workspace picker.
 * Lists directories (and optionally files) at a path.
 */
export function registerFsRoutes(app: FastifyInstance) {
  app.get("/api/fs", async (request) => {
    const q = request.query as { path?: string; files?: string };
    let target = (q.path || homedir()).trim() || homedir();
    try {
      target = resolve(target);
      if (existsSync(target)) {
        target = realpathSync(target);
      }
    } catch {
      return { error: "Invalid path", path: target, parent: null, entries: [] as FsEntry[] };
    }

    let st;
    try {
      st = await stat(target);
    } catch {
      return { error: "Path not found", path: target, parent: null, entries: [] as FsEntry[] };
    }

    if (!st.isDirectory()) {
      return {
        error: "Not a directory",
        path: target,
        parent: dirname(target),
        entries: [] as FsEntry[],
      };
    }

    const includeFiles = q.files === "1" || q.files === "true";
    const entries: FsEntry[] = [];
    try {
      const names = await readdir(target);
      for (const name of names) {
        if (name === "." || name === "..") continue;
        // skip noisy/hidden system-ish dirs in listing (still navigable if typed)
        if (name === "node_modules" || name === ".git") continue;
        const full = join(target, name);
        try {
          const s = await stat(full);
          if (s.isDirectory()) {
            entries.push({ name, path: full, isDir: true });
          } else if (includeFiles) {
            entries.push({ name, path: full, isDir: false });
          }
        } catch {
          // permission denied etc.
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "list failed";
      return { error: message, path: target, parent: parentOf(target), entries: [] as FsEntry[] };
    }

    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      path: target,
      parent: parentOf(target),
      entries,
    };
  });
}

function parentOf(p: string): string | null {
  const d = dirname(p);
  if (d === p) return null;
  // avoid empty
  if (!d) return null;
  return d;
}
