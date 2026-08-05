import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDbForDataDir } from "../../db/client";
import { turns } from "../../db/schema";
import { createSession } from "../sessions/db";
import { resolveContextTurnIds } from "./project-chat";

const SESSION_ID = "test-resolve-ctx-ids";
let dataDir: string;

function insertTurn(turnNumber: number, kind: "turn" | "summary" = "turn"): number {
  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();
  const row = db
    .insert(turns)
    .values({
      sessionId: SESSION_ID,
      turnNumber,
      userContent: `t${turnNumber}`,
      userTimestamp: now,
      status: "success",
      success: 1,
      startedAt: now,
      completedAt: now,
      kind,
    })
    .returning({ id: turns.id })
    .get();
  return row!.id;
}

describe("resolveContextTurnIds", () => {
  beforeAll(async () => {
    dataDir = join(tmpdir(), `vsh-ctx-ids-${Date.now()}`);
    await mkdir(dataDir, { recursive: true });
    createSession(
      {
        id: SESSION_ID,
        title: "t",
        providerName: "p",
        modelName: "m",
        thinkingEffort: "off",
        workspaceRoot: dataDir,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        kind: "primary",
      },
      dataDir,
    );
    for (let i = 1; i <= 10; i++) insertTurn(i);
    insertTurn(11, "summary"); // synthetic summary row — must never enter history IDs
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("excludes kind=summary rows", () => {
    const ids = resolveContextTurnIds(SESSION_ID, dataDir, { firstTurnNumber: null });
    const db = getDbForDataDir(dataDir);
    const rows = db
      .select({ id: turns.id, kind: turns.kind, turnNumber: turns.turnNumber })
      .from(turns)
      .all()
      .filter((r) => ids.includes(r.id));
    expect(rows.every((r) => (r.kind ?? "turn") === "turn")).toBe(true);
    expect(rows.some((r) => r.turnNumber === 11)).toBe(false);
  });

  test("pin firstTurnNumber=5 keeps only turns >= 5", () => {
    const ids = resolveContextTurnIds(SESSION_ID, dataDir, { firstTurnNumber: 5 });
    const db = getDbForDataDir(dataDir);
    const nums = db
      .select({ id: turns.id, turnNumber: turns.turnNumber })
      .from(turns)
      .all()
      .filter((r) => ids.includes(r.id))
      .map((r) => r.turnNumber)
      .sort((a, b) => a - b);
    expect(nums[0]).toBe(5);
    expect(nums.every((n) => n >= 5)).toBe(true);
    expect(nums).not.toContain(11);
  });
});
