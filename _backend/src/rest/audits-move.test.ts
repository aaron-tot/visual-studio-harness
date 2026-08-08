import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { moveAudit } from "./audits";
import { MoveError } from "./scope-move";

const roots: string[] = [];

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vsh-audit-move-"));
  roots.push(root);
  return root;
}

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

async function seedAudit(dataDir: string, name: string, scope: "global" | "project" | "session"): Promise<string> {
  const dir =
    scope === "session"
      ? join(dataDir, "session", "s1", "audits", name)
      : scope === "project"
        ? join(dataDir, "..", ".agentHarness", "audits", name)
        : join(dataDir, "audits", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "audit.json"),
    JSON.stringify({ meta: { id: name, scope }, findings: [] }, null, 2) + "\n",
  );
  return dir;
}

describe("moveAudit", () => {
  it("moves an audit from global to session and rewrites meta.scope", async () => {
    const dataDir = await tmpRoot();
    await seedAudit(dataDir, "mem-audit", "global");
    const r = await moveAudit({
      name: "mem-audit",
      fromScope: "global",
      toScope: "session",
      dataDir,
      sessionId: "s1",
    });
    expect(r.scope).toBe("session");
    const to = join(dataDir, "session", "s1", "audits", "mem-audit", "audit.json");
    expect(existsSync(to)).toBe(true);
    expect(existsSync(join(dataDir, "audits", "mem-audit"))).toBe(false);
    const doc = JSON.parse(await (await import("node:fs/promises")).readFile(to, "utf-8"));
    expect(doc.meta.scope).toBe("session");
  });

  it("throws MoveError(400) when target scope session has no sessionId", async () => {
    const dataDir = await tmpRoot();
    await seedAudit(dataDir, "a1", "global");
    try {
      await moveAudit({ name: "a1", fromScope: "global", toScope: "session", dataDir });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MoveError);
      expect((e as MoveError).code).toBe(400);
    }
  });
});
