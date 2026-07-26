import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb } from "./db";
import { createWorkspaceGraphRepository } from "./repository";

describe("WorkspaceGraphRepository", () => {
  let testDir: string;
  let dbPath: string;

  function freshTestDir() {
    const dir = join(tmpdir(), "wg-test-" + randomUUID());
    mkdirSync(join(dir, ".vsh"), { recursive: true });
    return dir;
  }

  beforeEach(() => {
    testDir = freshTestDir();
    dbPath = join(testDir, ".vsh", "workspace-graph.db");
  });

  afterEach(() => {
    try { closeWorkspaceGraphDb(dbPath); } catch {}
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("creates workspace-graph.db and stores workspace + file rows", async () => {
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);

    await repo.upsertWorkspace({
      rootPath: testDir,
      graphVersion: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      indexedAtMs: Date.now(),
    });

    const fileId = await repo.upsertFile({
      path: "src/index.ts",
      filename: "index.ts",
      extension: "ts",
      language: "typescript",
      size: 42,
      modifiedMs: Date.now(),
      fileHash: "abc123",
      indexedAtMs: Date.now(),
    });

    expect(fileId).toBeGreaterThan(0);
  });

  it("upserts file and replaces symbols, imports, and exports", async () => {
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);

    await repo.upsertWorkspace({
      rootPath: testDir,
      graphVersion: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      indexedAtMs: Date.now(),
    });

    const fileId = await repo.upsertFile({
      path: "src/greet.ts",
      filename: "greet.ts",
      extension: "ts",
      language: "typescript",
      size: 100,
      modifiedMs: Date.now(),
      fileHash: "def456",
      indexedAtMs: Date.now(),
    });

    await repo.replaceFileSymbols(fileId, [
      {
        name: "greet",
        kind: "function",
        parentId: null,
        fileId,
        exported: true,
        async: false,
        static: false,
        visibility: "public",
        signature: "greet(name: string): string",
        startLine: 1,
        endLine: 3,
        structuralHash: "hash1",
      },
    ]);

    await repo.replaceFileImports(fileId, [
      {
        module: "node:path",
        symbols: JSON.stringify(["join"]),
        importType: "named",
        fileId,
      },
    ]);

    await repo.replaceFileExports(fileId, [
      { symbol: "greet", isDefault: false, fileId },
    ]);

    const found = await repo.findFileByPath("src/greet.ts");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(fileId);
  });

  it("deletes file by path", async () => {
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);

    await repo.upsertWorkspace({
      rootPath: testDir,
      graphVersion: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      indexedAtMs: Date.now(),
    });

    const fileId = await repo.upsertFile({
      path: "src/delete-me.ts",
      filename: "delete-me.ts",
      extension: "ts",
      language: "typescript",
      size: 10,
      modifiedMs: Date.now(),
      fileHash: "fff",
      indexedAtMs: Date.now(),
    });

    expect(fileId).toBeGreaterThan(0);
    await repo.deleteFileByPath("src/delete-me.ts");

    const found = await repo.findFileByPath("src/delete-me.ts");
    expect(found).toBeNull();
  });

  it("lists indexed files for change detection", async () => {
    const db = openWorkspaceGraphDb(dbPath);
    const repo = createWorkspaceGraphRepository(db);

    await repo.upsertWorkspace({
      rootPath: testDir,
      graphVersion: 1,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      indexedAtMs: Date.now(),
    });

    await repo.upsertFile({
      path: "src/a.ts",
      filename: "a.ts",
      extension: "ts",
      language: "typescript",
      size: 10,
      modifiedMs: 1000,
      fileHash: "aaa",
      indexedAtMs: Date.now(),
    });
    await repo.upsertFile({
      path: "src/b.ts",
      filename: "b.ts",
      extension: "ts",
      language: "typescript",
      size: 20,
      modifiedMs: 2000,
      fileHash: "bbb",
      indexedAtMs: Date.now(),
    });

    const indexed = await repo.listIndexedFiles();
    expect(indexed.length).toBe(2);
    const paths = indexed.map((r) => r.path).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });
});