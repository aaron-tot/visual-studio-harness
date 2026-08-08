import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { moveNote, findNoteScope } from "./notes";
import { MoveError } from "./scope-move";

const roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vsh-note-move-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe("moveNote", () => {
  it("moves a note from global to session dir", async () => {
    const dataDir = await tmpRoot();
    const globalDir = join(dataDir, "notes", "my-note");
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, "note.json"), JSON.stringify({ title: "T", body: "B", meta: { createdAt: "x", updatedAt: "x" } }));
    const r = await moveNote({ name: "my-note", fromScope: "global", toScope: "session", dataDir, sessionId: "s1" });
    const to = join(dataDir, "session", "s1", "notes", "my-note", "note.json");
    expect(r.toPath).toBe(join(dataDir, "session", "s1", "notes", "my-note"));
    expect(existsSync(to)).toBe(true);
    expect(existsSync(join(dataDir, "notes", "my-note"))).toBe(false);
  });

  it("findNoteScope resolves session before global", async () => {
    const dataDir = await tmpRoot();
    const g = join(dataDir, "notes", "dup");
    await mkdir(g, { recursive: true });
    await writeFile(join(g, "note.json"), "{}");
    const s = join(dataDir, "session", "s1", "notes", "dup");
    await mkdir(s, { recursive: true });
    await writeFile(join(s, "note.json"), "{}");
    expect(await findNoteScope("dup", dataDir, undefined, "s1")).toBe("session");
  });

  it("throws MoveError(400) when target session scope has no sessionId", async () => {
    const dataDir = await tmpRoot();
    const g = join(dataDir, "notes", "n1");
    await mkdir(g, { recursive: true });
    await writeFile(join(g, "note.json"), "{}");
    try {
      await moveNote({ name: "n1", fromScope: "global", toScope: "session", dataDir });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(400);
    }
  });
});
