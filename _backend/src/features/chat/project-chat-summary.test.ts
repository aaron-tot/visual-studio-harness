import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, summaryRanges, steps, stepParts } from "../../db/schema";
import { createSession } from "../sessions/db";
import { projectSessionChat } from "./project-chat";

const SESSION_ID = "test-project-chat-summary";
let dataDir: string;

function insertRealTurn(turnNumber: number, content: string): number {
  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();
  const row = db
    .insert(turns)
    .values({
      sessionId: SESSION_ID,
      turnNumber,
      userContent: content,
      userTimestamp: now,
      status: "success",
      success: 1,
      startedAt: now,
      completedAt: now,
      kind: "turn",
    })
    .returning({ id: turns.id })
    .get();
  return row!.id;
}

function insertSummaryTurn(
  turnNumber: number,
  summaryText: string,
  opts?: { status?: string; meta?: Record<string, unknown> },
): number {
  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();
  const status = opts?.status ?? "success";
  const row = db
    .insert(turns)
    .values({
      sessionId: SESSION_ID,
      turnNumber,
      userContent: "Summarize prompt (hidden in chat UI)",
      userTimestamp: now,
      status,
      success: status === "success" ? 1 : 0,
      startedAt: now,
      completedAt: status === "success" ? now : null,
      kind: "summary",
      configSnapshotJson: opts?.meta ? JSON.stringify(opts.meta) : null,
    })
    .returning({ id: turns.id })
    .get();
  const turnId = row!.id;
  if (status !== "success") return turnId;
  const step = db
    .insert(steps)
    .values({
      sessionId: SESSION_ID,
      turnId,
      stepIndex: 0,
      status: "completed",
      startedAt: now,
      completedAt: now,
    })
    .returning({ id: steps.id })
    .get();
  db.insert(stepParts)
    .values({
      sessionId: SESSION_ID,
      turnId,
      stepId: step!.id,
      type: "text",
      seq: 0,
      status: "completed",
      data: JSON.stringify({ content: summaryText }),
      createdAt: now,
    })
    .run();
  return turnId;
}

describe("projectSessionChat summary placement", () => {
  beforeAll(async () => {
    const base = join(tmpdir(), `vsh-project-chat-summary-${Date.now()}`);
    dataDir = join(base, "data");
    await mkdir(join(dataDir, "sessions", SESSION_ID), { recursive: true });
    getDbForDataDir(dataDir);
    createSession(
      {
        id: SESSION_ID,
        title: "summary placement",
        providerName: "test",
        modelName: "test",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      dataDir,
    );
  });

  afterAll(async () => {
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  test("summary sits after covered turns and before live turns (at circle)", () => {
    // Real turns 1..6, summary covers 1..3 (circle between 3 and 4),
    // synthetic turnNumber=99 would sort last if placement used turnNumber.
    insertRealTurn(1, "one");
    insertRealTurn(2, "two");
    insertRealTurn(3, "three");
    insertRealTurn(4, "four");
    insertRealTurn(5, "five");
    insertRealTurn(6, "six");
    const summaryTurnId = insertSummaryTurn(99, "SUMMARY_OF_1_TO_3");

    const db = getDbForDataDir(dataDir);
    db.insert(summaryRanges)
      .values({
        sessionId: SESSION_ID,
        summaryTurnId,
        startTurn: 1,
        endTurn: 3,
        prevRangeId: null,
        originalTokens: 100,
        summaryTokens: 10,
        createdAt: new Date().toISOString(),
      })
      .run();

    const msgs = projectSessionChat(SESSION_ID, dataDir);
    const timeline = msgs.map((m) => {
      if (m.role === "system" && m.isSummary) return `M@${m.summaryEndTurn}`;
      if (m.isSummary && m.role === "assistant") return `S@${m.summaryEndTurn}`;
      if (m.role === "user") return `T${m.turnId}`;
      return null;
    }).filter(Boolean);

    // Marker sits at the circle position, then the pair (user anchored at the
    // end turn, assistant with the summary), then the live turns.
    expect(timeline).toEqual([
      "T1", "T2", "T3",
      "M@3", "T3", "S@3",
      "T4", "T5", "T6",
    ]);

    // Completed summary = system marker + user prompt + assistant summary.
    const summaryMsgs = msgs.filter((m) => m.isSummary);
    expect(summaryMsgs).toHaveLength(3);
    expect(summaryMsgs[0].role).toBe("system");
    expect(summaryMsgs[0].content).toBe("Summary generated"); // legacy row, no meta
    expect(summaryMsgs[0].status).toBe("success");
    expect(summaryMsgs[1].role).toBe("user");
    expect(summaryMsgs[2].role).toBe("assistant");
    expect(summaryMsgs[2].content).toContain("SUMMARY_OF_1_TO_3");
    expect(summaryMsgs[2].turnId).toBe(3);
  });

  test("pending summary emits ONLY the system marker at the requested range anchor (no summary_ranges row yet)", () => {
    // Real pending state: no summary_ranges row exists until success — the
    // projection must anchor the placeholder via the snapshot's requested range.
    insertSummaryTurn(90, "", {
      status: "pending",
      meta: { kind: "summary", range: { startTurn: 7, endTurn: 8 }, initiatedAt: "2026-08-16T10:00:00.000Z", initiator: "slider" },
    });

    const msgs = projectSessionChat(SESSION_ID, dataDir);
    const markers = msgs.filter((m) => m.isSummary && m.summaryEndTurn === 8);
    expect(markers).toHaveLength(1);
    expect(markers[0].role).toBe("system");
    expect(markers[0].status).toBe("pending");
    expect(markers[0].turnId).toBe(8); // anchored at the range end, not the DB turnNumber
    expect(markers[0].content).toBe(
      "SUMMARY BEING GENERATED AT 2026-08-16T10:00:00.000Z: initiated by [slider]",
    );
    // No user/assistant pair while pending.
    expect(msgs.filter((m) => m.isSummary && m.role !== "system" && m.summaryEndTurn === 8)).toHaveLength(0);
  });

  test("failed summary emits ONLY the marker with error status (range from snapshot)", () => {
    insertSummaryTurn(91, "", {
      status: "error",
      meta: { kind: "summary", range: { startTurn: 9, endTurn: 9 }, initiatedAt: "2026-08-16T11:00:00.000Z", initiator: "keyboard" },
    });

    const msgs = projectSessionChat(SESSION_ID, dataDir);
    const markers = msgs.filter((m) => m.isSummary && m.summaryEndTurn === 9);
    expect(markers).toHaveLength(1);
    expect(markers[0].role).toBe("system");
    expect(markers[0].status).toBe("error");
    expect(markers[0].content).toContain("initiated by [keyboard]");
  });

  test("completed summary with meta renders marker with datetime + initiator", () => {
    insertSummaryTurn(92, "SUM_10", {
      status: "success",
      meta: {
        kind: "summary",
        initiatedAt: "2026-08-16T12:00:00.000Z",
        initiator: "context-menu",
        childSessionId: "sessionID_child_1",
        childTurnNumber: 1,
      },
    });
    const db = getDbForDataDir(dataDir);
    const okId = db
      .select({ id: turns.id })
      .from(turns)
      .where(eq(turns.turnNumber, 92))
      .get()!.id;
    db.insert(summaryRanges)
      .values({
        sessionId: SESSION_ID,
        summaryTurnId: okId,
        startTurn: 10,
        endTurn: 10,
        prevRangeId: null,
        originalTokens: 10,
        summaryTokens: 5,
        createdAt: new Date().toISOString(),
      })
      .run();

    const msgs = projectSessionChat(SESSION_ID, dataDir);
    const group = msgs.filter((m) => m.isSummary && m.summaryEndTurn === 10);
    expect(group).toHaveLength(3);
    expect(group[0].role).toBe("system");
    expect(group[0].content).toBe(
      "SUMMARY BEING GENERATED AT 2026-08-16T12:00:00.000Z: initiated by [context-menu]",
    );
    expect(group[0].childSessionId).toBe("sessionID_child_1"); // openable sub-session
    expect(group[1].role).toBe("user");
    expect(group[2].role).toBe("assistant");
    expect(group[2].content).toContain("SUM_10");
  });
});
