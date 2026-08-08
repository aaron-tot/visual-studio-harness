import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { moveDesign, findDesignScope } from "./plans";
import { MoveError } from "./scope-move";

const roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vsh-design-move-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe("moveDesign", () => {
  it("moves a design and rewrites createdMeta", async () => {
    const dataDir = await tmpRoot();
    const g = join(dataDir, "designs", "my-design");
    await mkdir(g, { recursive: true });
    await writeFile(
      join(g, "specV1.json"),
      JSON.stringify({ meta: { version: 1, createdMeta: { workspace: "", session: "" } } }, null, 2) + "\n",
    );
    const r = await moveDesign({ name: "my-design", fromScope: "global", toScope: "session", dataDir, sessionId: "s1" });
    const to = join(dataDir, "session", "s1", "designs", "my-design", "specV1.json");
    expect(existsSync(to)).toBe(true);
    expect(existsSync(join(dataDir, "designs", "my-design"))).toBe(false);
    const doc = JSON.parse(await (await import("node:fs/promises")).readFile(to, "utf-8"));
    expect(doc.meta.createdMeta.session).toBe("s1");
    expect(doc.meta.createdMeta.workspace).toBe("");
  });

  it("findDesignScope resolves session before global", async () => {
    const dataDir = await tmpRoot();
    await mkdir(join(dataDir, "designs", "d1"), { recursive: true });
    await mkdir(join(dataDir, "session", "s1", "designs", "d1"), { recursive: true });
    expect(await findDesignScope("d1", dataDir, undefined, "s1")).toBe("session");
  });

  it("throws MoveError(409) when target exists", async () => {
    const dataDir = await tmpRoot();
    await mkdir(join(dataDir, "designs", "d1"), { recursive: true });
    await mkdir(join(dataDir, "session", "s1", "designs", "d1"), { recursive: true });
    try {
      await moveDesign({ name: "d1", fromScope: "global", toScope: "session", dataDir, sessionId: "s1" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(409);
    }
  });
});
