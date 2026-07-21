import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";

const MODE = process.env.MODE || "dev";

/**
 * Resolve the runtime data directory.
 *
 * Priority:
 *   1. DATA_DIR env var (set by run-prod.ts or start.sh)
 *   2. Compiled binary → OS standard config directory:
 *        Linux:   $XDG_CONFIG_HOME/visual-studio-harness/  or  ~/.config/visual-studio-harness/
 *        macOS:   ~/Library/Application Support/visual-studio-harness/
 *        Windows: %APPDATA%/visual-studio-harness/
 *   3. Dev from source → projectRoot/data/{mode}
 *   4. Last resort → cwd
 *
 * Never use import.meta.dir alone for runtime files in prod — under Bun
 * --compile it becomes /$bunfs/root, which is not the real data dir.
 */
export function resolveDataDir(): string {
  if (process.env.DATA_DIR) {
    return resolve(process.env.DATA_DIR);
  }

  if (process.env.BUILD_TYPE === "portable") {
    return join(dirname(process.execPath), "data");
  }

  const execPath = process.execPath;
  const execName = execPath.split(/[/\\]/).pop() || "";
  // Real path only — skip bun virtual FS
  if (execName.startsWith("visual-studio-harness") && !execPath.includes("$bunfs")) {
    return osDataDir();
  }

  // _backend/src -> ../../.. = Visual Studio Harness/ (parent of repoSource, data/ lives here)
  //   src/ -> _backend/ -> repoSource root -> Visual Studio Harness/
  const metaDir = import.meta.dir;
  if (metaDir && !metaDir.includes("$bunfs")) {
    const projectRoot = resolve(metaDir, "../../..");
    return join(projectRoot, "data", MODE);
  }

  // Last resort: cwd (run-prod sets cwd to data/prod)
  return resolve(process.cwd());
}

function osDataDir(): string {
  const plat = platform();
  const appName = "visual-studio-harness";

  if (plat === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), appName);
  }
  if (plat === "darwin") {
    return join(homedir(), "Library", "Application Support", appName);
  }
  // Linux / others
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), appName);
}

export function osDataDirForDisplay(): string {
  return osDataDir();
}

export function getMode(): string {
  return MODE;
}

export function getPort(): number {
  return parseInt(process.env.BACKEND_PORT || (MODE === "prod" ? "3002" : "3001"), 10);
}
