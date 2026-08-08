import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedBuiltinToolFolders } from "./folder-seed";
import { listToolFolders, loadToolEntry, loadToolsFromFolders } from "./folder-store";
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

  it("list aggregates seeded entries through the ctx.services contract", async () => {
    // Call the raw entry execute (bypassing folderToToolDef, which would inject
    // the real dataDir-bound services) so we can stub ctx.services and lock in
    // the exact method names + arg shapes the list entry depends on.
    await loadSeededTools();
    const folder = (await listToolFolders(dataDir)).find((f) => f.name === "list")!;
    const { execute } = await loadToolEntry(folder);

    const calls: {
      listDesigns?: unknown[];
      listNotes?: unknown[];
      listAudits?: unknown[];
      kbListDocuments?: unknown[];
    } = {};
    const kbDataDirs: string[] = [];

    const services = {
      listDesigns: async (scope: unknown, workspaceRoot: unknown, sessionId: unknown) => {
        calls.listDesigns = [scope, workspaceRoot, sessionId];
        return [
          {
            name: "design-1",
            specs: [{ meta: { version: 1 } }, { meta: { version: 2 } }],
            plans: [{ meta: { version: 3 } }],
          },
        ];
      },
      listNotes: async (scope: unknown, workspaceRoot: unknown, sessionId: unknown) => {
        calls.listNotes = [scope, workspaceRoot, sessionId];
        return [{ name: "note-1", title: "My Note" }];
      },
      listAudits: async (scope: unknown, workspaceRoot: unknown, sessionId: unknown) => {
        calls.listAudits = [scope, workspaceRoot, sessionId];
        return [
          {
            name: "audit-1",
            document: {
              meta: { title: "Audit T", auditType: "security", totalFindings: 3 },
            },
          },
        ];
      },
      KnowledgeBaseService: class {
        constructor(dataDir: string) {
          kbDataDirs.push(dataDir);
        }
        async listDocuments(scope: unknown, filters: unknown, workspaceRoot: unknown, sessionId: unknown) {
          calls.kbListDocuments = [scope, filters, workspaceRoot, sessionId];
          return [
            {
              id: "kb-1",
              filename: "doc.md",
              extension: "md",
              fileSize: 42,
              status: "active",
              tags: ["kb", "dev"],
              createdBy: "alice",
            },
          ];
        }
      },
    };

    const ctx = { ...fakeBaseCtx(dataDir, ws), services };
    const result = (await execute({ scope: "global" }, ctx)) as {
      title: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain("## designs (global): 1 item(s)");
    expect(result.output).toContain("design-1/  (specs: v1, v2, plans: v3)");
    expect(result.output).toContain("note-1  — My Note");
    expect(result.output).toContain("audit-1  — Audit T (security, 3 findings)");
    expect(result.output).toContain("ID:kb-1  doc.md  (md, 42 bytes, status: active, tags: kb, dev, by: alice)");
    expect(result.metadata?.totalCount).toBe(4);

    // Lock in the exact arg shapes the entry passes to each service.
    expect(calls.listDesigns).toEqual(["global", ws, "sess-entries-1"]);
    expect(calls.listNotes).toEqual(["global", ws, "sess-entries-1"]);
    expect(calls.listAudits).toEqual(["global", ws, "sess-entries-1"]);
    const kbFilters = calls.kbListDocuments?.[1] as Record<string, unknown>;
    expect(calls.kbListDocuments).toEqual([
      "global",
      kbFilters,
      ws,
      "sess-entries-1",
    ]);
    expect(kbFilters).toHaveProperty("extension");
    expect(kbFilters).toHaveProperty("status");
    expect(kbFilters).toHaveProperty("createdBy");
    expect(kbDataDirs).toEqual([dataDir]);
  });

  it("read returns an error result when the file does not exist", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const read = defs.find((d) => d.name === "read")!;

    const result = await read.execute({ path: "missing.txt" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("file not found");
  });

  it("loads the complex re-authored builtins from real seeds with callable execute", async () => {
    const defs = await loadSeededTools();
    const byName = new Map(defs.map((d) => [d.name, d]));

    // skill / customTool / task / agent_change have their own folders.
    // websearch + webfetch were consolidated into searchOnline (action dispatch);
    // their seed folders are content-only and never registered.
    for (const name of ["skill", "customTool", "task", "agent_change", "searchOnline"]) {
      const def = byName.get(name);
      expect(def, `${name} should be loaded`).toBeDefined();
      expect(typeof def!.execute, `${name} execute callable`).toBe("function");
    }
  });

  it("customTool create->list->read->delete round-trips in a temp dataDir", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const ct = defs.find((d) => d.name === "customTool")!;

    const create = await ct.execute(
      {
        action: "create",
        name: "hello_util",
        description: "says hi",
        code: "return 'hi ' + args.who;",
      },
      ctx
    );
    expect(create.isError).toBeFalsy();
    expect(create.output).toContain("created successfully");

    const list = await ct.execute({ action: "list" }, ctx);
    expect(list.isError).toBeFalsy();
    expect(list.output).toContain("hello_util");

    const read = await ct.execute({ action: "read", name: "hello_util" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("says hi");
    expect(read.output).toContain("hello_util");

    const update = await ct.execute(
      { action: "update", name: "hello_util", description: "says hello" },
      ctx
    );
    expect(update.isError).toBeFalsy();
    expect(update.output).toContain("updated successfully");

    const readAgain = await ct.execute({ action: "read", name: "hello_util" }, ctx);
    expect(readAgain.output).toContain("says hello");

    const del = await ct.execute({ action: "delete", name: "hello_util" }, ctx);
    expect(del.isError).toBeFalsy();
    expect(del.output).toContain("deleted successfully");

    const listAfter = await ct.execute({ action: "list" }, ctx);
    expect(listAfter.output).not.toContain("hello_util");
  });

  it("customTool rejects invalid names/unknown actions gracefully", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const ct = defs.find((d) => d.name === "customTool")!;

    const badName = await ct.execute(
      { action: "create", name: "bad name!", description: "x", code: "return 1;" },
      ctx
    );
    expect(badName.isError).toBe(true);
    expect(badName.output).toContain("invalid name");

    const badAction = await ct.execute({ action: "explode" }, ctx);
    expect(badAction.isError).toBe(true);
    expect(badAction.output).toContain("unknown action");
  });

  it("skill list and read resolve a temp skill file under the default ctx skill roots", async () => {
    await mkdir(join(dataDir, "mds", "_skills", "my-skill"), { recursive: true });
    await writeFile(
      join(dataDir, "mds", "_skills", "my-skill", "SKILL.md"),
      "# My Skill\n\nHelpful guidance.\n"
    );

    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const skill = defs.find((d) => d.name === "skill")!;

    const list = await skill.execute({ mode: "list" }, ctx);
    expect(list.isError).toBeFalsy();
    expect(list.output).toContain("my-skill");

    const read = await skill.execute({ name: "my-skill" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("# My Skill");

    const missing = await skill.execute({ name: "does-not-exist" }, ctx);
    expect(missing.isError).toBe(true);
    expect(missing.output).toContain("not found");
  });

  it("skill list mode returns an error when no skill is named for content mode", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const skill = defs.find((d) => d.name === "skill")!;

    const result = await skill.execute({ mode: "content" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'name' is required");
  });

  it("agent_change returns a graceful error when only one agent exists", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const ac = defs.find((d) => d.name === "agent_change")!;

    const result = await ac.execute({ suggestedAgent: "x", reason: "y" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Only one agent configuration exists");
  });

  it("task returns graceful errors for missing args and when the subagent bridge is absent", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const task = defs.find((d) => d.name === "task")!;

    const missingArgs = await task.execute({}, ctx);
    expect(missingArgs.isError).toBe(true);
    expect(missingArgs.output).toContain("required");

    // Full args, but the ctx.subagent bridge is not wired in this test env:
    // must return an error result rather than throw or hit the network.
    const noBridge = await task.execute(
      { agent_name: "main", description: "probe", prompt: "do nothing" },
      ctx
    );
    expect(noBridge.isError).toBe(true);
    expect(noBridge.output).toContain("not available");
  });

  it("searchOnline search returns a graceful error without hitting the network when no providers are registered", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const searchOnline = defs.find((d) => d.name === "searchOnline")!;

    const noQuery = await searchOnline.execute({ action: "search" }, ctx);
    expect(noQuery.isError).toBe(true);
    expect(noQuery.output).toContain("query is required");

    const noProviders = await searchOnline.execute({ action: "search", query: "example" }, ctx);
    expect(noProviders.isError).toBe(true);
    expect(noProviders.output).toContain("Unknown error");
  });

  it("searchOnline fetch returns a graceful error for missing/invalid URLs", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const searchOnline = defs.find((d) => d.name === "searchOnline")!;

    const noUrl = await searchOnline.execute({ action: "fetch" }, ctx);
    expect(noUrl.isError).toBe(true);
    expect(noUrl.output).toContain("url is required");

    const badUrl = await searchOnline.execute({ action: "fetch", url: "not-a-url" }, ctx);
    expect(badUrl.isError).toBe(true);
    expect(badUrl.output).toContain("must start with http");

    const unknown = await searchOnline.execute({ action: "bogus" }, ctx);
    expect(unknown.isError).toBe(true);
    expect(unknown.output).toContain("Unknown searchOnline action");
  });

  it("loads the re-authored consolidated dispatchers with callable execute", async () => {
    const defs = await loadSeededTools();
    const byName = new Map(defs.map((d) => [d.name, d]));

    for (const name of ["design", "notes", "audit", "graph", "knowledge", "todo"]) {
      const def = byName.get(name);
      expect(def, `${name} should be loaded`).toBeDefined();
      expect(typeof def!.execute, `${name} execute callable`).toBe("function");
    }
  });

  it("todo write->read round-trips through the session todos store", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const todo = defs.find((d) => d.name === "todo")!;

    const write = await todo.execute(
      {
        action: "write",
        todos: [
          { id: "t-1", content: "hello todos", status: "pending" },
          { id: "t-2", content: "second item", status: "completed" },
        ],
      },
      ctx
    );
    expect(write.isError).toBeFalsy();
    expect(write.output).toContain("hello todos");
    expect(write.output).toContain("1 open of 2");

    const read = await todo.execute({ action: "read" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("hello todos");
    expect(read.output).toContain("second item");
  });

  it("todo rejects the removed add/update/remove/clear/list actions as unknown", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const todo = defs.find((d) => d.name === "todo")!;

    for (const action of ["add", "update", "remove", "clear", "list"]) {
      const result = await todo.execute({ action }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("Unknown todo action");
    }
  });

  it("notes create->read->update->archive round-trips in a temp dataDir", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const notes = defs.find((d) => d.name === "notes")!;

    const create = await notes.execute(
      { action: "create", name: "note-one", title: "Note One", body: "hello body", scope: "global" },
      ctx
    );
    expect(create.isError).toBeFalsy();
    expect(create.metadata?.created).toBe(true);

    const read = await notes.execute({ action: "read", name: "note-one" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.output).toContain("hello body");

    const update = await notes.execute(
      { action: "update", name: "note-one", body: "updated body" },
      ctx
    );
    expect(update.isError).toBeFalsy();
    const readAgain = await notes.execute({ action: "read", name: "note-one" }, ctx);
    expect(readAgain.output).toContain("updated body");

    const archive = await notes.execute({ action: "archive", name: "note-one" }, ctx);
    expect(archive.isError).toBeFalsy();
    expect(archive.metadata?.archived).toBe(true);

    const removedList = await notes.execute({ action: "list", scope: "global" }, ctx);
    expect(removedList.isError).toBe(true);
    expect(removedList.output).toContain("Unknown notes action");
  });

  it("design create round-trips through ctx.services in a temp dataDir", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const design = defs.find((d) => d.name === "design")!;

    const created = await design.execute(
      { action: "create", name: "design-one", type: "spec", goal: "build X", scope: "global" },
      ctx
    );
    expect(created.isError).toBeFalsy();
    expect(created.metadata?.version).toBe(1);

    const removedList = await design.execute({ action: "list", scope: "global" }, ctx);
    expect(removedList.isError).toBe(true);
    expect(removedList.output).toContain("Unknown design action");
  });

  it("audit create round-trips in a temp dataDir", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const audit = defs.find((d) => d.name === "audit")!;

    const created = await audit.execute(
      {
        action: "create",
        name: "audit-one",
        title: "Audit One",
        auditType: "general_audit",
        endGoal: "Check overall quality",
        summary: "Everything looks fine",
        findings: [
          {
            severity: "low",
            title: "Minor nit",
            description: "Small issue",
            recommendation: "Fix it",
            category: "style",
          },
        ],
        scope: "global",
      },
      ctx
    );
    expect(created.isError).toBeFalsy();
    expect(created.metadata?.created).toBe(true);

    const removedList = await audit.execute({ action: "list", scope: "global" }, ctx);
    expect(removedList.isError).toBe(true);
    expect(removedList.output).toContain("Unknown audit action");
  });

  it("graph returns a graceful error when the graph service is null", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const graph = defs.find((d) => d.name === "graph")!;

    const result = await graph.execute({ action: "status" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Graph service not available");
  });

  it("knowledge returns graceful errors when the KB is unavailable and rejects the removed list action", async () => {
    const defs = await loadSeededTools();
    const ctx = fakeBaseCtx(dataDir, ws);
    const knowledge = defs.find((d) => d.name === "knowledge")!;

    // KB service is not configured in this test env — search must not throw or
    // hit the network; it returns an error result instead.
    const search = await knowledge.execute({ action: "search", query: "example" }, ctx);
    expect(search.isError).toBe(true);
    expect(search.output).toContain("Knowledge Base");

    // The list action was never part of the consolidated dispatcher enum.
    const removedList = await knowledge.execute({ action: "list", scope: "global" }, ctx);
    expect(removedList.isError).toBe(true);
    expect(removedList.output).toContain("Unknown knowledge action");
  });

});
