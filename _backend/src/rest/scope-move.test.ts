import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { moveScopedDir, MoveError } from "./scope-move";

const roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vsh-scope-move-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe("moveScopedDir", () => {
  it("moves a directory between roots preserving contents", async () => {
    const root = await tmpRoot();
    const fromDir = join(root, "from");
    const toDir = join(root, "to");
    await mkdir(join(fromDir, "doc"), { recursive: true });
    await writeFile(join(fromDir, "doc", "audit.json"), "{}");
    const r = await moveScopedDir({ name: "doc", fromDir, toDir });
    expect(r.toPath).toBe(join(toDir, "doc"));
    expect(existsSync(join(toDir, "doc", "audit.json"))).toBe(true);
    expect(existsSync(join(fromDir, "doc"))).toBe(false);
  });

  it("throws MoveError(404) when source is missing", async () => {
    const root = await tmpRoot();
    try {
      await moveScopedDir({ name: "nope", fromDir: root, toDir: root });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(404);
    }
  });

  it("throws MoveError(409) when target exists", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, "doc"), { recursive: true });
    await writeFile(join(root, "doc", "a.txt"), "x");
    const toDir = join(root, "to");
    await mkdir(join(toDir, "doc"), { recursive: true });
    try {
      await moveScopedDir({ name: "doc", fromDir: root, toDir });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(409);
    }
  });

  it("cleans up the temp dir and leaves no partial target when the copy fails", async () => {
    const root = await tmpRoot();
    const fromDir = join(root, "from");
    await mkdir(join(fromDir, "doc"), { recursive: true });
    await writeFile(join(fromDir, "doc", "a.txt"), "x");
    const toDir = join(root, "to");
    await writeFile(toDir, "i am a file, not a dir");
    await expect(moveScopedDir({ name: "doc", fromDir, toDir })).rejects.toThrow();
    const leftovers = await (await import("node:fs/promises")).readdir(root);
    expect(leftovers.filter((f) => f.includes(".tmp-"))).toEqual([]);
    expect(existsSync(join(fromDir, "doc", "a.txt"))).toBe(true); // source intact
  });
});
