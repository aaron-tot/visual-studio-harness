import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadToolsFromFolders, resolveToolCtx } from "./folder-store";
import type { BaseToolContext } from "./types";

function fakeBaseCtx(dataDir: string): BaseToolContext {
  return {
    sessionId: "sess-1",
    turnId: 1,
    workspaceRoot: join(dataDir, "..", "ws"),
    dataDir,
    abortSignal: new AbortController().signal,
    callId: "call-1",
    askPermission: async () => true,
    graphService: null,
    agentSettings: {},
    toolSettings: {},
  };
}

describe("tool ctx surface", () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-folder-store-ctx-test-"));
    dataDir = join(testDir, "data");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("exposes the expanded ctx surface (host helpers, format, datetime, services)", () => {
    const ctx = resolveToolCtx(fakeBaseCtx(dataDir), "probe");

    // host helpers
    expect(typeof ctx.runInPersistentBash).toBe("function");
    expect(typeof ctx.atomicWriteFile).toBe("function");
    expect(typeof ctx.applyPatchText).toBe("function");
    expect(typeof ctx.findClosestMatch).toBe("function");
    expect(typeof ctx.formatSuggestion).toBe("function");
    expect(typeof ctx.runFd).toBe("function");
    expect(typeof ctx.runRipgrep).toBe("function");
    expect(typeof ctx.findSymbols).toBe("function");
    expect(typeof ctx.readSymbolRange).toBe("function");
    expect(typeof ctx.getSearchProviderRegistry).toBe("function");

    // format constants/helpers
    expect(typeof ctx.DEFAULT_GREP_MAX_MATCHES).toBe("number");
    expect(typeof ctx.clipLine).toBe("function");
    expect(typeof ctx.countOccurrences).toBe("function");

    // datetime
    expect(typeof ctx.localISOString).toBe("function");
    expect(typeof ctx.localISOString()).toBe("string");
    expect(ctx.localISOString().length).toBeGreaterThan(0);

    // custom-tools store helpers
    expect(typeof ctx.customToolToToolDef).toBe("function");
    expect(typeof ctx.loadCustomToolDefs).toBe("function");

    // services (rest / knowledge / storage)
    expect(ctx.services).toBeDefined();
    expect(typeof ctx.services?.createNote).toBe("function");
    expect(typeof ctx.services?.updateNote).toBe("function");
    expect(typeof ctx.services?.archiveNote).toBe("function");
    expect(typeof ctx.services?.listNotes).toBe("function");
    expect(typeof ctx.services?.resolveNotesDir).toBe("function");
    expect(typeof ctx.services?.findNoteDirByName).toBe("function");
    expect(typeof ctx.services?.allPossibleNotesDirs).toBe("function");
    expect(typeof ctx.services?.createAudit).toBe("function");
    expect(typeof ctx.services?.editAudit).toBe("function");
    expect(typeof ctx.services?.deleteAudit).toBe("function");
    expect(typeof ctx.services?.listAudits).toBe("function");
    expect(typeof ctx.services?.readAuditDocument).toBe("function");
    expect(typeof ctx.services?.resolveAuditsDir).toBe("function");
    expect(typeof ctx.services?.findAuditScope).toBe("function");
    expect(typeof ctx.services?.createPrompt).toBe("function");
    expect(typeof ctx.services?.editPrompt).toBe("function");
    expect(typeof ctx.services?.deletePrompt).toBe("function");
    expect(typeof ctx.services?.readPrompt).toBe("function");
    expect(typeof ctx.services?.readPromptFile).toBe("function");
    expect(typeof ctx.services?.listPromptEntries).toBe("function");
    expect(typeof ctx.services?.resolveAuditPromptsDir).toBe("function");
    expect(typeof ctx.services?.seedPromptsIfNeeded).toBe("function");
    expect(typeof ctx.services?.createSpecDocument).toBe("function");
    expect(typeof ctx.services?.createPlanDocument).toBe("function");
    expect(typeof ctx.services?.listDesigns).toBe("function");
    expect(typeof ctx.services?.resolveDesignsDir).toBe("function");
    expect(typeof ctx.services?.listAgents).toBe("function");
    expect(typeof ctx.services?.KnowledgeBaseService).toBe("function");
    expect(typeof ctx.services?.openDocumentByIdOrFilename).toBe("function");
    expect(typeof ctx.services?.AGENT_FILENAME_PREFIX).toBe("string");
    expect(typeof ctx.services?.getLiveSessionMeta).toBe("function");
    expect(typeof ctx.services?.getSessionTodosJson).toBe("function");
    expect(typeof ctx.services?.setSessionTodosJson).toBe("function");
  });

  it("binds the dataDir into services so entries never pass it", () => {
    const ctx = resolveToolCtx(fakeBaseCtx(dataDir), "probe");

    // notes dirs derive from the bound dataDir
    expect(ctx.services.allPossibleNotesDirs()).toEqual([
      join(dataDir, "notes"),
      join(dataDir, "session", "notes"),
    ]);
    // audit prompts dir derives from the bound dataDir
    expect(ctx.services.resolveAuditPromptsDir()).toBe(join(dataDir, "audit-prompts"));
    // session meta read is bound to sessionId + dataDir
    expect(typeof ctx.services.getLiveSessionMeta).toBe("function");
    // runInPersistentBash wrapper hides sessionId/abortSignal
    expect(typeof ctx.runInPersistentBash).toBe("function");
  });

  it("lets a probe entry call ctx.localISOString() and see services + host helpers", async () => {
    const dir = join(dataDir, "tools", "custom", "probe");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "probe.json"),
      JSON.stringify({
        name: "probe",
        description: "Probe tool",
        entry: "index.js",
        inputSchema: {},
        enabled: true,
        permissionDefault: "allow",
      })
    );
    await writeFile(
      join(dir, "index.js"),
      `export async function execute(args, ctx) {
  return {
    output: JSON.stringify({
      ts: ctx.localISOString(),
      hasCreateNote: typeof ctx.services.createNote === "function",
      hasRunFd: typeof ctx.runFd === "function",
      hasAtomicWriteFile: typeof ctx.atomicWriteFile === "function",
      hasRunRipgrep: typeof ctx.runRipgrep === "function",
      hasApplyPatchText: typeof ctx.applyPatchText === "function",
      hasPersistentBash: typeof ctx.runInPersistentBash === "function",
    }),
  };
}
`
    );

    const defs = await loadToolsFromFolders(dataDir);
    const probe = defs.find((d) => d.name === "probe")!;
    const result = await probe.execute({}, fakeBaseCtx(dataDir));
    const parsed = JSON.parse(result.output) as Record<string, unknown>;

    expect(typeof parsed.ts).toBe("string");
    expect(String(parsed.ts).length).toBeGreaterThan(0);
    expect(parsed.hasCreateNote).toBe(true);
    expect(parsed.hasRunFd).toBe(true);
    expect(parsed.hasAtomicWriteFile).toBe(true);
    expect(parsed.hasRunRipgrep).toBe(true);
    expect(parsed.hasApplyPatchText).toBe(true);
    expect(parsed.hasPersistentBash).toBe(true);
  });
});
