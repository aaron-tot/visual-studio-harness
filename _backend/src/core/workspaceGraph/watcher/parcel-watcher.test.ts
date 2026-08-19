import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startWorkspaceWatcher } from "./watch";
import { resolveIgnoredDirs, ignoredDirsToGlobs, readWatchBackend } from "./config";

function freshDir() {
  const dir = join(tmpdir(), "wg-parcel-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("watcher backend dispatch", () => {
  it("uses the native @parcel/watcher backend and reports it", async () => {
    const workspaceRoot = freshDir();
    const watcher = await startWorkspaceWatcher({
      workspaceRoot,
      debounceMs: 50,
      onBatch: async () => {},
    });
    // In dev @parcel/watcher is available, so it should pick the native backend.
    expect(watcher.backend).toBe("parcel");
    await watcher.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });
});

describe("watcher config helpers", () => {
  it("translates ignored dir names to parcel glob patterns", () => {
    const globs = ignoredDirsToGlobs(["node_modules", ".vsh"]);
    expect(globs).toEqual(["**/node_modules", "**/node_modules/**", "**/.vsh", "**/.vsh/**"]);
  });

  it("reads backend preference from env", () => {
    process.env.VSH_WATCH_BACKEND = "js";
    expect(readWatchBackend()).toBe("js");
    delete process.env.VSH_WATCH_BACKEND;
    expect(readWatchBackend()).toBe("native");
  });

  it("trims slashes from ignored names", () => {
    const dirs = resolveIgnoredDirs(["/node_modules/", "  dist  "]);
    expect(dirs).toEqual(["node_modules", "dist"]);
  });
});
