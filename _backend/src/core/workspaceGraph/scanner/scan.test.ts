import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { scanWorkspace } from "./scan";

function freshDir() {
  const dir = join(tmpdir(), "wg-scan-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("scanWorkspace", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = freshDir();
  });

  afterEach(() => {
    try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  });

  it("classifies created, modified, unchanged, and deleted files", async () => {
    writeFileSync(join(workspaceRoot, "src/new.ts"), "export const x = 1;\n");
    writeFileSync(join(workspaceRoot, "src/changed.ts"), "export const y = 2;\n");
    writeFileSync(join(workspaceRoot, "src/unchanged.ts"), "export const z = 3;\n");

    const existingIndex = [
      { path: "src/changed.ts", fileHash: "oldhash", modifiedMs: 0 },
      { path: "src/unchanged.ts", fileHash: await getHashForFile(join(workspaceRoot, "src/unchanged.ts")), modifiedMs: (await getStatMs(join(workspaceRoot, "src/unchanged.ts"))) },
      { path: "src/deleted.ts", fileHash: "deletedhash", modifiedMs: 100 },
    ];

    const result = await scanWorkspace({ workspaceRoot, existingIndex });

    const createdPaths = result.created.map((f) => f.path);
    const modifiedPaths = result.modified.map((f) => f.path);
    const deletedPaths = result.deleted.map((f) => f.path);
    const unchangedPaths = result.unchanged.map((f) => f.path);

    expect(createdPaths).toContain("src/new.ts");
    expect(modifiedPaths).toContain("src/changed.ts");
    expect(deletedPaths).toContain("src/deleted.ts");
    expect(unchangedPaths).toContain("src/unchanged.ts");
  });

  it("ignores node_modules, .git, and hidden dirs", async () => {
    mkdirSync(join(workspaceRoot, "node_modules"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".git"), { recursive: true });
    writeFileSync(join(workspaceRoot, "node_modules/foo.ts"), "export const x = 1;\n");
    writeFileSync(join(workspaceRoot, ".git/config"), "key = value\n");
    writeFileSync(join(workspaceRoot, "src/real.ts"), "export const real = true;\n");

    const result = await scanWorkspace({ workspaceRoot, existingIndex: [] });
    const paths = result.created.map((f) => f.path);
    expect(paths).not.toContain("node_modules/foo.ts");
    expect(paths).not.toContain(".git/config");
    expect(paths).toContain("src/real.ts");
  });

  it("only includes configured extensions", async () => {
    writeFileSync(join(workspaceRoot, "src/app.ts"), "export const a = 1;\n");
    writeFileSync(join(workspaceRoot, "src/app.js"), "export const a = 1;\n");
    writeFileSync(join(workspaceRoot, "src/app.css"), ".a { color: red; }\n");

    const result = await scanWorkspace({ workspaceRoot, existingIndex: [], includeExtensions: [".ts"] });
    const paths = result.created.map((f) => f.path);
    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/app.js");
    expect(paths).not.toContain("src/app.css");
  });
});

async function getHashForFile(filePath: string): Promise<string> {
  const { computeFileHash } = await import("./hash");
  return computeFileHash(filePath);
}

async function getStatMs(filePath: string): Promise<number> {
  const { stat } = await import("node:fs/promises");
  const st = await stat(filePath);
  return st.mtimeMs;
}