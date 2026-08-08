import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBuiltinToolFolders } from "./folder-seed";
import { loadToolsFromFolders } from "./folder-store";
import type { BaseToolContext } from "./types";

function fakeBaseCtx(dataDir: string, workspaceRoot: string): BaseToolContext {
  return {
    sessionId: "sess-entries-1",
    turnId: 1,
    workspaceRoot,
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-entries-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
  };
}

describe("builtin entries (real data-folder path)", () => {
  let testDir: string;
  let dataDir: string;
  let ws: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-builtin-entries-test-"));
    dataDir = join(testDir, "data");
    ws = join(testDir, "ws");
    await mkdir(ws, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  /** Seed dev builtins into a fresh data dir and load the folder ToolDefs. */
  async function loadSeededTools() {
    await seedBuiltinToolFolders(dataDir, "dev");
    return loadToolsFromFolders(dataDir);
  }

  it("loads the re-authored simple builtins from real seeds with callable execute", async () => {
    const defs = await loadSeededTools();
    const byName = new Map(defs.map((d) => [d.name, d]));

    // grep/glob were consolidated into searchLocal (action dispatch) — so the
    // simple re-authored set is read/write/edit/apply_patch/list/bash + searchLocal.
    for (const name of ["read", "write", "edit", "apply_patch", "list", "bash", "searchLocal"]) {
      const def = byName.get(name);
      expect(def, `${name} should be loaded`).toBeDefined();
      expect(typeof def!.execute, `${name} execute callable`).toBe("function");
    }
  });

  it("write creates a file; read returns numbered lines + metadata", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const write = defs.find((d) => d.name === "write")!;
    const read = defs.find((d) => d.name === "read")!;

    const content = "line one\nline two\nline three\n";
    const w = await write.execute({ path: "a.txt", content }, ctx);
    expect(w.metadata?.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    // split(/\r?\n/) leaves a trailing empty entry after the final newline
    expect(w.metadata?.lines).toBe(4);

    const r = await read.execute({ path: "a.txt" }, ctx);
    expect(r.output).toContain("line one");
    expect(r.output).toContain("line three");
    expect(r.metadata?.path).toBe(join(ws, "a.txt"));
    // 3 lines + trailing empty from final newline
    expect(r.metadata?.linesReturned).toBe(4);
    expect(r.metadata?.totalLines).toBe(4);
  });

  it("read honors offset/limit", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const write = defs.find((d) => d.name === "write")!;
    const read = defs.find((d) => d.name === "read")!;

    const content = Array.from({ length: 10 }, (_, i) => `row ${i}`).join("\n") + "\n";
    await write.execute({ path: "rows.txt", content }, ctx);

    const r = await read.execute({ path: "rows.txt", offset: 5, limit: 3 }, ctx);
    expect(r.output).toContain("row 5");
    expect(r.output).toContain("row 7");
    expect(r.output).not.toContain("row 0");
    expect(r.metadata?.linesReturned).toBe(3);
    // split(/\r?\n/) leaves a trailing empty entry after the final newline
    expect(r.metadata?.totalLines).toBe(11);
  });

  it("edit replaces old_string (single + replace_all)", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const write = defs.find((d) => d.name === "write")!;
    const edit = defs.find((d) => d.name === "edit")!;
    const read = defs.find((d) => d.name === "read")!;

    await write.execute({ path: "e.txt", content: "foo bar foo\n" }, ctx);
    const edited = await edit.execute({ path: "e.txt", old_string: "bar", new_string: "BAZ" }, ctx);
    expect(edited.output).toContain("1 replacement");
    expect((await read.execute({ path: "e.txt" }, ctx)).output).toContain("foo BAZ foo");

    const all = await edit.execute(
      { path: "e.txt", old_string: "foo", new_string: "X", replace_all: true },
      ctx
    );
    expect(all.output).toContain("2 replacement");
    const final = (await read.execute({ path: "e.txt" }, ctx)).output;
    expect(final).toContain("X BAZ X");
    expect(final).not.toContain("foo");
  });

  it("apply_patch adds and updates files", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const patch = defs.find((d) => d.name === "apply_patch")!;
    const read = defs.find((d) => d.name === "read")!;

    const addResult = await patch.execute(
      {
        patchText: `*** Add File: new.txt\nhello world\n`,
      },
      ctx
    );
    expect(addResult.metadata?.files).toContain("new.txt");
    expect((await read.execute({ path: "new.txt" }, ctx)).output).toContain("hello world");

    const updateResult = await patch.execute(
      {
        patchText: `*** Update File: new.txt\n<<<<<<< SEARCH\nhello world\n=======\nhello again\n>>>>>>> REPLACE\n`,
      },
      ctx
    );
    expect(updateResult.metadata?.files).toContain("new.txt");
    expect((await read.execute({ path: "new.txt" }, ctx)).output).toContain("hello again");
  });

  it("searchLocal glob action finds files in a temp workspace", async () => {
    await writeFile(join(ws, "alpha.ts"), "x");
    await writeFile(join(ws, "beta.ts"), "x");
    await writeFile(join(ws, "gamma.md"), "x");

    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const searchLocal = defs.find((d) => d.name === "searchLocal")!;

    const result = await searchLocal.execute({ action: "glob", pattern: "*.ts" }, ctx);
    expect(result.output).toContain("alpha.ts");
    expect(result.output).toContain("beta.ts");
    expect(result.output).not.toContain("gamma.md");
    expect(result.metadata?.count).toBe(2);
  });

  it("searchLocal grep action finds matching lines in a file", async () => {
    await writeFile(join(ws, "search.txt"), "apple\nbanana\ncherry\n");

    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const searchLocal = defs.find((d) => d.name === "searchLocal")!;

    const result = await searchLocal.execute(
      { action: "grep", pattern: "banana", path: "search.txt" },
      ctx
    );
    expect(result.output).toContain("banana");
    expect(result.output).not.toContain("apple");
  });

  it("bash runs a benign command and returns exit code", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const bash = defs.find((d) => d.name === "bash")!;

    const result = await bash.execute(
      { command: "echo benign-ok", timeout_ms: 5000, description: "benign echo" },
      ctx
    );
    // folderToToolDef only preserves isError=true; a clean run surfaces exitCode 0.
    expect(result.metadata?.exitCode).toBe(0);
    expect(result.output).toContain("benign-ok");
    expect(result.output).toContain("exit=0");
  });

  it("list returns an empty aggregate result without throwing", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const list = defs.find((d) => d.name === "list")!;

    const result = await list.execute({}, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("No designs, notes, audits, and knowledge found");
    expect(result.metadata?.count).toBe(0);
  });
});
