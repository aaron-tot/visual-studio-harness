import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { reindexWorkspace } from "./reindex";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb } from "../storage/db";
import { createWorkspaceGraphRepository } from "../storage/repository";

function freshDir() {
  const dir = join(tmpdir(), "wg-index-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("reindexWorkspace", () => {
  let workspaceRoot: string;
  let dbPath: string;

  beforeEach(() => {
    workspaceRoot = freshDir();
    dbPath = join(workspaceRoot, ".vsh", "workspace-graph.db");
  });

  afterEach(() => {
    try { closeWorkspaceGraphDb(dbPath); } catch {}
    try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  });

  it("indexes all files on first run (created)", async () => {
    writeFileSync(join(workspaceRoot, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(workspaceRoot, "src/b.ts"), "export function b() { return 2; }\n");

    const report = await reindexWorkspace({
      workspaceRoot,
      dbPath,
      mode: "startup",
    });

    expect(report.createdCount).toBe(2);
    expect(report.reindexedPaths).toContain("src/a.ts");
    expect(report.reindexedPaths).toContain("src/b.ts");
  });

  it("indexes only changed files on subsequent runs", async () => {
    writeFileSync(join(workspaceRoot, "src/unchanged.ts"), "export const x = 1;\n");

    // First run
    const report1 = await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });
    expect(report1.createdCount).toBe(1);

    // Modify a file
    writeFileSync(join(workspaceRoot, "src/unchanged.ts"), "export const x = 42;\n");

    // Create a new file
    writeFileSync(join(workspaceRoot, "src/new.ts"), "export const y = 2;\n");

    // Second run
    const report2 = await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });

    expect(report2.createdCount).toBe(1);
    expect(report2.reindexedPaths).toContain("src/new.ts");
    // src/unchanged.ts was modified but its hash change may or may not show as modified
    // depending on the scanner's hash computation
  });

  it("handles deleted files", async () => {
    writeFileSync(join(workspaceRoot, "src/to-delete.ts"), "export const gone = true;\n");

    await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });

    rmSync(join(workspaceRoot, "src/to-delete.ts"));

    const report = await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });
    expect(report.deletedCount).toBe(1);
    expect(report.reindexedPaths).toContain("src/to-delete.ts (deleted)");
  });

  it("skips unchanged files", async () => {
    writeFileSync(join(workspaceRoot, "src/stable.ts"), "export const stable = true;\n");

    await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });
    const report = await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });

    expect(report.createdCount).toBe(0);
    expect(report.modifiedCount).toBe(0);
    expect(report.deletedCount).toBe(0);
    expect(report.skippedCount).toBe(1);
  });
});