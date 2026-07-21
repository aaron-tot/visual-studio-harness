import { realpathSync, existsSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export function getWorkspaceRoot(): string {
  const env = process.env.VISUAL_STUDIO_HARNESS_WORKSPACE?.trim();
  if (env) return resolve(env);

  const cwd = resolve(process.cwd());
  // `bun run --filter _backend` often sets cwd to _backend/
  if (cwd.endsWith(`${sep}source${sep}backend`)) {
    return resolve(cwd, "../.."); // project root (sibling of source/ + data/)
  }
  if (cwd.endsWith(`${sep}backend`)) {
    return resolve(cwd, "..");
  }
  return cwd;
}

/** Expand leading ~/ or ~ to the process home directory. */
export function expandHome(userPath: string): string {
  if (userPath === "~") return process.env.HOME || process.env.USERPROFILE || userPath;
  if (userPath.startsWith("~/") || userPath.startsWith("~\\")) {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) return join(home, userPath.slice(2));
  }
  return userPath;
}

export interface PathClassification {
  /** Absolute path (realpath when the path exists). */
  abs: string;
  /** True when abs is outside workspace root. */
  outsideWorkspace: boolean;
  workspaceRoot: string;
}

/**
 * Classify a user path relative to workspace without permission checks.
 * Expands ~. Does not throw for outside paths.
 */
export function classifyPath(workspaceRoot: string, userPath: string): PathClassification {
  if (!userPath || typeof userPath !== "string") {
    throw new SandboxError("ERROR sandbox: path is required");
  }
  if (userPath.includes("\0")) {
    throw new SandboxError("ERROR sandbox: path contains null byte");
  }

  const root = resolve(workspaceRoot);
  const rootReal = existsSync(root) ? realpathSync(root) : root;
  const expanded = expandHome(userPath.trim());

  const candidate = isAbsolute(expanded)
    ? normalize(expanded)
    : normalize(join(root, expanded));

  const resolved = resolve(candidate);

  let finalPath = resolved;
  try {
    if (existsSync(resolved)) {
      finalPath = realpathSync(resolved);
    }
  } catch {
    finalPath = resolved;
  }

  const rootWithSep = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  const outsideWorkspace =
    finalPath !== rootReal && !finalPath.startsWith(rootWithSep);

  return {
    abs: finalPath,
    outsideWorkspace,
    workspaceRoot: rootReal,
  };
}

/**
 * Resolve a user path under workspaceRoot only. Throws if outside.
 * Prefer resolveAccessiblePath when external_directory permission is allowed.
 */
export function resolveWorkspacePath(workspaceRoot: string, userPath: string): string {
  const c = classifyPath(workspaceRoot, userPath);
  if (c.outsideWorkspace) {
    throw new SandboxError(
      `ERROR sandbox: path '${userPath}' escapes workspace root ${c.workspaceRoot}`
    );
  }
  return c.abs;
}
