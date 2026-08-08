import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { notesTool } from "../consolidated/notes";
import { notesMoveTool } from "../builtins/notes_move";

const roots: string[] = [];

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

function baseCtx(dataDir: string) {
  return {
    dataDir,
    sessionId: "s1",
    workspaceRoot: "/tmp",
    abortSignal: null,
    callId: "c",
    askPermission: async () => true,
    hookCtx: undefined,
  } as any;
}

describe("notes move action", () => {
  it("exposes 'move' in the action enum", () => {
    const schema = notesTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect(values).toContain("move");
  });

  it("requires toScope for move but keeps fromScope optional (auto-resolved)", () => {
    const schema = notesTool.inputSchema as any;
    expect(schema.safeParse({ action: "move" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", toScope: "session" }).success).toBe(true);
    expect(schema.safeParse({ action: "move", fromScope: "global", toScope: "global" }).success).toBe(false);
  });

  it("moves a note via the consolidated tool", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-note-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "notes", "tool-note");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.json"), JSON.stringify({ title: "T", body: "B", meta: { createdAt: "x", updatedAt: "x" } }));
    const res = await notesTool.execute(
      { action: "move", name: "tool-note", fromScope: "global", toScope: "session" },
      baseCtx(dataDir),
    );
    expect(res.isError).toBeFalsy();
    expect(existsSync(join(dataDir, "session", "s1", "notes", "tool-note", "note.json"))).toBe(true);
  });

  it("notes_move tool resolves fromScope via findNoteScope when omitted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-note-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "session", "s1", "notes", "sess-note");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.json"), JSON.stringify({ title: "T", body: "B", meta: {} }));
    const res = await notesMoveTool.execute({ name: "sess-note", toScope: "global" }, baseCtx(dataDir));
    expect(res.isError).toBeFalsy();
    expect(res.output).toContain("from session to global");
    expect(existsSync(join(dataDir, "notes", "sess-note", "note.json"))).toBe(true);
  });
});
