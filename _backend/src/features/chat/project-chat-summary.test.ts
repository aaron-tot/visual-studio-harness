import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDbForDataDir } from "../../db/client";
import { turns, summaryBlocks, steps, stepParts } from "../../db/schema";
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

function insertSummaryTurn(turnNumber: number, summaryText: string): number {
  const db = getDbForDataDir(dataDir);
  const now = new Date().toISOString();
  const row = db
    .insert(turns)
    .values({
      sessionId: SESSION_ID,
      turnNumber,
      userContent: "Summarize prompt (hidden in chat UI)",
      userTimestamp: now,
      status: "success",
      success: 1,
      startedAt: now,
      completedAt: now,
      kind: "summary",
    })
    .returning({ id: turns.id })
    .get();
  const turnId = row!.id;
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
    db.insert(summaryBlocks)
      .values({
        sessionId: SESSION_ID,
        summaryTurnId,
        startTurn: 1,
        endTurn: 3,
        prevBlockId: null,
        originalTokens: 100,
        summaryTokens: 10,
        createdAt: new Date().toISOString(),
      })
      .run();

    const msgs = projectSessionChat(SESSION_ID, dataDir);
    const timeline = msgs.map((m) => {
      if (m.isSummary) return `S@${m.summaryEndTurn}`;
      if (m.role === "user") return `T${m.turnId}`;
      return null;
    }).filter(Boolean);

    expect(timeline).toEqual([
      "T1", "T2", "T3",
      "S@3",
      "T4", "T5", "T6",
    ]);

    // Single assistant bubble — not a user+assistant pair with the prompt.
    const summaryMsgs = msgs.filter((m) => m.isSummary);
    expect(summaryMsgs).toHaveLength(1);
    expect(summaryMsgs[0].role).toBe("assistant");
    expect(summaryMsgs[0].content).toContain("SUMMARY_OF_1_TO_3");
    expect(summaryMsgs[0].turnId).toBe(3);
  });
});
