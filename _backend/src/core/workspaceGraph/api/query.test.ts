import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { openWorkspaceGraphDb, closeWorkspaceGraphDb } from "../storage/db";
import { createWorkspaceGraphRepository } from "../storage/repository";
import { createQueryApi } from "./query";
import { createManifestApi } from "./manifest";
import { reindexWorkspace } from "../indexer/reindex";
import type { WorkspaceGraphDb } from "../storage/db";

function freshDir() {
  const dir = join(tmpdir(), "wg-api-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "src/utils"), { recursive: true });
  return dir;
}

describe("workspaceGraph query and manifest", () => {
  let workspaceRoot: string;
  let dbPath: string;
  let db: WorkspaceGraphDb;

  beforeEach(async () => {
    workspaceRoot = freshDir();
    dbPath = join(workspaceRoot, ".vsh", "workspace-graph.db");

    writeFileSync(join(workspaceRoot, "src/index.ts"), `
      import { join } from "node:path";
      import { greet } from "./utils/greet";

      export function main() {
        return greet("world");
      }
    `);

    writeFileSync(join(workspaceRoot, "src/utils/greet.ts"), `
      import { resolve } from "node:path";

      export function greet(name: string): string {
        return "Hello, " + name;
      }

      export class Greeter {
        prefix: string;
        constructor(p: string) { this.prefix = p; }
      }
    `);

    // Index the files
    await reindexWorkspace({ workspaceRoot, dbPath, mode: "startup" });
    db = openWorkspaceGraphDb(dbPath);
  });

  afterEach(() => {
    try { closeWorkspaceGraphDb(dbPath); } catch {}
    try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  });

  describe("query", () => {
    it("findSymbol returns exported function", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const matches = await query.findSymbol("main", "function");
      expect(matches.length).toBe(1);
      expect(matches[0].filePath.endsWith("src/index.ts")).toBe(true);
    });

    it("findFunction returns matching functions", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const matches = await query.findFunction("greet");
      expect(matches.length).toBe(1);
      expect(matches[0].symbol.kind).toBe("function");
    });

    it("findClass returns classes", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const matches = await query.findClass("Greeter");
      expect(matches.length).toBe(1);
      expect(matches[0].symbol.kind).toBe("class");
    });

    it("listImports returns imports for a file", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const imports = await query.listImports("src/index.ts");
      expect(imports.some((i) => i.module === "node:path")).toBe(true);
    });

    it("listExports returns exports for a file", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const exports = await query.listExports("src/utils/greet.ts");
      expect(exports.some((e) => e.symbol === "greet")).toBe(true);
    });

    it("listFiles returns all indexed files", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const files = await query.listFiles();
      expect(files.length).toBe(2);
    });

    it("workspaceSummary returns correct counts", async () => {
      const query = createQueryApi(db, createWorkspaceGraphRepository(db));

      const summary = await query.workspaceSummary();
      expect(summary.fileCount).toBe(2);
      expect(summary.symbolCount).toBeGreaterThan(0);
    });
  });

  describe("manifest", () => {
    it("workspaceManifest renders ASCII tree from database rows", async () => {
      const manifest = createManifestApi(db);

      const text = await manifest.workspaceManifest({ maxDepth: 2 });
      expect(text).toContain("src");
      expect(text).toContain(".");
    });

    it("workspaceManifestFiles includes files", async () => {
      const manifest = createManifestApi(db);

      const text = await manifest.workspaceManifestFiles({ maxDepth: 3 });
      expect(text).toContain("index.ts");
      expect(text).toContain("greet.ts");
    });

    it("workspaceSummary returns text summary", async () => {
      const manifest = createManifestApi(db);

      const summary = await manifest.workspaceSummary();
      expect(summary).toContain("Files:");
      expect(summary).toContain("Symbols:");
    });
  });
});