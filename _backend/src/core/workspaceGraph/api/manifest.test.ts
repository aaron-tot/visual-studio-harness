import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb } from "../storage/db";
import { createManifestApi } from "./manifest";
import { reindexWorkspace } from "../indexer/reindex";
import type { WorkspaceGraphDb } from "../storage/db";

function freshDir() {
  const dir = join(tmpdir(), "wg-manifest-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/utils"), { recursive: true });
  mkdirSync(join(dir, "src/components"), { recursive: true });
  return dir;
}

describe("workspaceGraph manifest API", () => {
  let workspaceRoot: string;
  let dbPath: string;
  let db: WorkspaceGraphDb;

  beforeEach(async () => {
    workspaceRoot = freshDir();
    dbPath = join(workspaceRoot, ".vsh", "workspace-graph.db");

    writeFileSync(join(workspaceRoot, "src/index.ts"), `
      import { greet } from "./utils/greet";
      export function main() { return greet("world"); }
    `);

    writeFileSync(join(workspaceRoot, "src/utils/greet.ts"), `
      export function greet(name: string): string { return "Hello, " + name; }
    `);

    writeFileSync(join(workspaceRoot, "src/components/Button.tsx"), `
      export function Button() { return null; }
    `);

    await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });
    db = openWorkspaceGraphDb(dbPath);
  });

  afterEach(() => {
    try { closeWorkspaceGraphDb(dbPath); } catch {}
    try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  });

  it("workspaceManifest renders tree with root dot", async () => {
    const manifest = createManifestApi(db);
    const text = await manifest.workspaceManifest({ maxDepth: 3 });
    expect(text).toContain(".");
    expect(text).toContain("src");
  });

  it("workspaceManifest respects maxDepth", async () => {
    const manifest = createManifestApi(db);
    const shallow = await manifest.workspaceManifest({ maxDepth: 1 });
    expect(shallow).not.toContain("greet.ts");

    const deep = await manifest.workspaceManifest({ maxDepth: 5 });
    expect(deep).toContain("greet.ts");
  });

  it("workspaceManifestFiles includes all source files", async () => {
    const manifest = createManifestApi(db);
    const text = await manifest.workspaceManifestFiles({ maxDepth: 5 });
    expect(text).toContain("index.ts");
    expect(text).toContain("greet.ts");
    expect(text).toContain("Button.tsx");
  });

  it("workspaceManifestFolders excludes files", async () => {
    const manifest = createManifestApi(db);
    const text = await manifest.workspaceManifestFolders({ maxDepth: 5 });
    expect(text).toContain("src");
    expect(text).not.toContain("index.ts");
    expect(text).not.toContain("greet.ts");
  });

  it("workspaceSummary returns counts and languages", async () => {
    const manifest = createManifestApi(db);
    const summary = await manifest.workspaceSummary();
    expect(summary).toContain("Files: 3");
    expect(summary).toContain("Symbols:");
    expect(summary).toContain("Languages:");
  });

  it("workspaceManifest excludes node_modules by default", async () => {
    mkdirSync(join(workspaceRoot, "node_modules"), { recursive: true });
    writeFileSync(join(workspaceRoot, "node_modules/foo.ts"), `export const x = 1;`);
    await reindexWorkspace({ workspaceRoot, dbPath, mode: "full" });
    db = openWorkspaceGraphDb(dbPath);

    const manifest = createManifestApi(db);
    const text = await manifest.workspaceManifest({ maxDepth: 5 });
    expect(text).not.toContain("node_modules");
  });
});
