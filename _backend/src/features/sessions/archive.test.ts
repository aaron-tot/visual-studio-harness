import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { getDbForDataDir, openRawDb, liveDbPath, archiveDbPath } from "../../db/client";
import { createSession, updateSessionFields, listSessions } from "./db";
import {
  createTurn,
  createStep,
  finalizeStep,
  finalizeTurnTrace,
  ensurePromptSnapshot,
  ensureToolsSnapshot,
  updateTurnSnapshots,
} from "../chat/db-trace";
import {
  moveSessionToArchive,
  migrateArchivedSessions,
} from "./archive";

let dataDir: string;

beforeAll(async () => {
  const base = join(
    tmpdir(),
    `vsh-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  getDbForDataDir(dataDir);
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

function seedSession(
  id: string,
  opts?: { kind?: "primary" | "subagent"; parentId?: string; title?: string },
) {
  const now = new Date().toISOString();
  createSession(
    {
      id,
      title: opts?.title ?? id,
      providerName: "test",
      modelName: "model",
      created: now,
      updated: now,
      kind: opts?.kind ?? "primary",
      parentId: opts?.parentId,
    },
    dataDir,
  );
}

function seedTurn(sessionId: string, num: number) {
  const now = new Date().toISOString();
  const t = createTurn(sessionId, num, `prompt ${sessionId} ${num}`, now, {}, dataDir);
  const s = createStep(t, sessionId, 0, {}, dataDir);
  finalizeStep(s, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, dataDir);
  finalizeTurnTrace(t, { success: true }, dataDir);
  return { t, s };
}

function arch(queries: (db: Database) => void) {
  const db = openRawDb(archiveDbPath(dataDir));
  try {
    queries(db);
  } finally {
    db.close();
  }
}

describe("moveSessionToArchive", () => {
  test("moves session + subagent child out of live; snapshot only deleted when unreferenced", () => {
    seedSession("P", { title: "Primary" });
    seedSession("C", { kind: "subagent", parentId: "P", title: "Child" });
    seedSession("Q", { title: "Other live" });

    const pTurn = seedTurn("P", 1);
    const cTurn = seedTurn("C", 1);
    const qTurn = seedTurn("Q", 1);

    // Shared prompt snapshot (P + Q reference it) and P-only tools snapshot.
    const sharedPrompt = ensurePromptSnapshot("shared-system-prompt", dataDir);
    const pOnlyTools = ensureToolsSnapshot('{"name":"p-tool"}', dataDir);
    updateTurnSnapshots(pTurn.t, sharedPrompt, pOnlyTools, dataDir);
    updateTurnSnapshots(qTurn.t, sharedPrompt, undefined, dataDir);
    void cTurn;

    moveSessionToArchive(dataDir, "P");

    // Live: P and C are gone; Q remains.
    const liveIds = listSessions({ dataDir }).map((s) => s.id);
    expect(liveIds).not.toContain("P");
    expect(liveIds).not.toContain("C");
    expect(liveIds).toContain("Q");

    // Live sessions table has no P/C rows.
    const live = new Database(liveDbPath(dataDir));
    try {
      const pLive = live.query("SELECT COUNT(*) n FROM sessions WHERE id IN ('P','C')").get() as { n: number };
      expect(pLive.n).toBe(0);

      // Shared snapshot survives in live because Q still references it.
      const sharedLive = live.query("SELECT COUNT(*) n FROM prompt_snapshots WHERE id = ?").get(sharedPrompt) as { n: number };
      expect(sharedLive.n).toBe(1);

      // P-only tools snapshot is removed from live (no remaining refs).
      const toolsLive = live.query("SELECT COUNT(*) n FROM tools_snapshots WHERE id = ?").get(pOnlyTools) as { n: number };
      expect(toolsLive.n).toBe(0);
    } finally {
      live.close();
    }

    // Archive has the session graph + snapshots.
    arch((db) => {
      const pArch = db.query("SELECT COUNT(*) n FROM sessions WHERE id IN ('P','C')").get() as { n: number };
      expect(pArch.n).toBe(2);
      const turnsArch = db.query("SELECT COUNT(*) n FROM turns WHERE session_id IN ('P','C')").get() as { n: number };
      expect(turnsArch.n).toBe(2);
      const sharedArch = db.query("SELECT COUNT(*) n FROM prompt_snapshots WHERE id = ?").get(sharedPrompt) as { n: number };
      expect(sharedArch.n).toBe(1);
      const toolsArch = db.query("SELECT COUNT(*) n FROM tools_snapshots WHERE id = ?").get(pOnlyTools) as { n: number };
      expect(toolsArch.n).toBe(1);
    });
  });

  test("re-archive is idempotent and session stays archived (no error)", () => {
    // P was already moved in the previous test; moving again must be a no-op.
    expect(() => moveSessionToArchive(dataDir, "P")).not.toThrow();
    const live = new Database(liveDbPath(dataDir));
    try {
      const n = live.query("SELECT COUNT(*) n FROM sessions WHERE id = 'P'").get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      live.close();
    }
  });
});

describe("migrateArchivedSessions", () => {
  test("moves pre-existing archived=1 rows (and subagent children) to archive", () => {
    seedSession("MIG1", { title: "Old archived" });
    seedSession("MIG2", { kind: "subagent", parentId: "MIG1", title: "Old child" });
    seedTurn("MIG1", 1);
    updateSessionFields("MIG1", { archived: true }, dataDir);

    const result = migrateArchivedSessions(dataDir);
    expect(result.moved).toBeGreaterThanOrEqual(1);
    expect(result.failed).toEqual([]);

    const live = new Database(liveDbPath(dataDir));
    try {
      const archived = live.query("SELECT COUNT(*) n FROM sessions WHERE archived = 1").get() as { n: number };
      expect(archived.n).toBe(0);
      const mig1 = live.query("SELECT COUNT(*) n FROM sessions WHERE id = 'MIG1'").get() as { n: number };
      expect(mig1.n).toBe(0);
      const mig2 = live.query("SELECT COUNT(*) n FROM sessions WHERE id = 'MIG2'").get() as { n: number };
      expect(mig2.n).toBe(0);
    } finally {
      live.close();
    }

    arch((db) => {
      const n = db.query("SELECT COUNT(*) n FROM sessions WHERE id IN ('MIG1','MIG2')").get() as { n: number };
      expect(n.n).toBe(2);
    });
  });
});
