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
 *
 * ⚠️  NEVER create a "dev" subdirectory under the OS config dir (~/.config/visual-studio-harness/dev/).
 *     That location is for PRODUCTION runtime data only. Dev mode uses projectRoot/data/dev/.
 *
 * 🚫  FOR AI AGENTS: NEVER write to /home/aaron/.config/visual-studio-harness/ or any OS config directory.
 *     That is the USER'S PRODUCTION DATA. Only the compiled binary at runtime should touch it.
 *     Dev/test data goes in: /home/aaron/Desktop/Visual Studio Harness/data/dev/
 *     Prod binary data goes in: /home/aaron/Desktop/Visual Studio Harness/data/prod/
 */
export type DataDirSource = "env" | "portable" | "installed" | "dev" | "cwd";

/**
 * Resolve the runtime data directory and how it was determined.
 *
 * Priority:
 *   1. DATA_DIR env var
 *   2. Portable binary → {binary-dir}/data
 *   3. Compiled binary → OS standard config directory
 *   4. Dev from source → projectRoot/data/{mode}
 *   5. Last resort → cwd
 */
export function resolveDataDirInfo(): { dataDir: string; source: DataDirSource } {
  if (process.env.DATA_DIR) {
    return { dataDir: resolve(process.env.DATA_DIR), source: "env" };
  }

  if (process.env.BUILD_TYPE === "portable") {
    return { dataDir: join(dirname(process.execPath), "data"), source: "portable" };
  }

  const execPath = process.execPath;
  const execName = execPath.split(/[/\\]/).pop() || "";
  // Real path only — skip bun virtual FS
  if (execName.startsWith("visual-studio-harness") && !execPath.includes("$bunfs")) {
    return { dataDir: osDataDir(), source: "installed" };
  }

  // _backend/src -> ../../.. = Visual Studio Harness/ (parent of repoSource, data/ lives here)
  //   src/ -> _backend/ -> repoSource root -> Visual Studio Harness/
  const metaDir = import.meta.dir;
  if (metaDir && !metaDir.includes("$bunfs")) {
    const projectRoot = resolve(metaDir, "../../..");
    return { dataDir: join(projectRoot, "data", MODE), source: "dev" };
  }

  // Last resort: cwd (run-prod sets cwd to data/prod)
  return { dataDir: resolve(process.cwd()), source: "cwd" };
}

export function resolveDataDir(): string {
  return resolveDataDirInfo().dataDir;
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
  return parseInt(process.env.BACKEND_PORT || (MODE === "prod" ? "4100" : "3101"), 10);
}
