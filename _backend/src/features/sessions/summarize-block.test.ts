import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { sessions, turns, summaryRanges, subagentSpawns, steps, stepParts } from "../../db/schema";
import {
  createSession,
  getSession,
  insertSummaryRange,
  getLatestSummaryRange,
  getEarliestLiveSummaryRange,
  getSummaryRangeByRange,
  getSummaryRangesForSession,
  getPendingSummaryTurns,
  markSummaryTurnError,
  expireStaleSummaryPlaceholders,
} from "./db";
import { insertSubagentSpawn, getSpawnByToolCallId } from "../subagents/db";
import { runSummaryBlock } from "./summarize-block";

const TEST_DATA_DIR = "/tmp/vsh-test-summarize-block";

describe("runSummaryBlock model-ref gate", () => {
  const base = {
    dataDir: "/tmp/vsh-test-summarize-block-ref",
    sessionId: "unused",
    startTurn: 1,
    endTurn: 1,
    rangeTurns: [] as { role: "user" | "assistant"; content: string }[],
    rangeGroups: [] as { userContent: string; assistantContents: string[] }[],
    priorSummary: null,
    initiator: "test",
  };

  it("rejects a missing model with the no-valid-model error", async () => {
    await expect(runSummaryBlock({ ...base, modelRef: null })).rejects.toThrow(
      /summary block: no valid summarization model/,
    );
  });

  it("does not reject an Openrouter vendor/model id as invalid format", async () => {
    try {
      await runSummaryBlock({
        ...base,
        modelRef: "Openrouter/deepseek/deepseek-v4-flash-0731",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/no valid summarization model/);
    }
  });
});

describe("Summary Ranges", () => {
  let testSessionId: string;

  beforeEach(() => {
    // Clean up any existing test data
    const db = getDbForDataDir(TEST_DATA_DIR);
    db.delete(summaryRanges).run();
    db.delete(turns).run();
    db.delete(sessions).run();

    // Create a test session
    createSession({
      id: "test-session-1",
      title: "Test Session",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    }, TEST_DATA_DIR);
    testSessionId = "test-session-1";
  });

  afterEach(() => {
    const db = getDbForDataDir(TEST_DATA_DIR);
    db.delete(summaryRanges).run();
    db.delete(turns).run();
    db.delete(sessions).run();
  });

  it("should create and retrieve a summary range", () => {
    const rangeId = insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 123,
      startTurn: 1,
      endTurn: 3,
      prevRangeId: null,
      originalTokens: 2400,
      summaryTokens: 300,
      createdAt: new Date().toISOString(),
    });

    expect(rangeId).toBeGreaterThan(0);

    const ranges = getSummaryRangesForSession(TEST_DATA_DIR, testSessionId);
    expect(ranges.length).toBe(1);
    expect(ranges[0].id).toBe(rangeId);
    expect(ranges[0].sessionId).toBe(testSessionId);
    expect(ranges[0].summaryTurnId).toBe(123);
    expect(ranges[0].startTurn).toBe(1);
    expect(ranges[0].endTurn).toBe(3);
    expect(ranges[0].prevRangeId).toBeNull();
    expect(ranges[0].originalTokens).toBe(2400);
    expect(ranges[0].summaryTokens).toBe(300);
  });

  it("should chain multiple summary ranges", () => {
    // First range
    const range1Id = insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 101,
      startTurn: 1,
      endTurn: 3,
      prevRangeId: null,
      originalTokens: 2400,
      summaryTokens: 300,
      createdAt: new Date().toISOString(),
    });

    // Second range references first
    const range2Id = insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 102,
      startTurn: 4,
      endTurn: 5,
      prevRangeId: range1Id,
      originalTokens: 1200,
      summaryTokens: 200,
      createdAt: new Date().toISOString(),
    });

    const ranges = getSummaryRangesForSession(TEST_DATA_DIR, testSessionId);
    expect(ranges.length).toBe(2);

    // Check chain
    const range2 = ranges.find(r => r.id === range2Id);
    expect(range2?.prevRangeId).toBe(range1Id);

    const range1 = ranges.find(r => r.id === range1Id);
    expect(range1?.prevRangeId).toBeNull();
  });

  it("should get latest summary range by endTurn", () => {
    insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 2,
      startTurn: 4,
      endTurn: 5,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    const latest = getLatestSummaryRange(TEST_DATA_DIR, testSessionId);
    expect(latest).not.toBeNull();
    expect(latest?.endTurn).toBe(5); // highest endTurn
  });

  it("should get earliest live summary range at slider position", () => {
    // Range 1: covers turns 1-3
    insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Range 2: covers turns 4-5 (after slider at turn 4)
    insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 2,
      startTurn: 4,
      endTurn: 5,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Slider at turn 4 - should get block 1 (endTurn=3 <= 4)
    const liveRange = getEarliestLiveSummaryRange(TEST_DATA_DIR, testSessionId, 4);
    expect(liveRange?.endTurn).toBe(3);

    // Slider at turn 3 - exact match
    const liveRange2 = getEarliestLiveSummaryRange(TEST_DATA_DIR, testSessionId, 3);
    expect(liveRange2?.endTurn).toBe(3);
  });

  it("should check idempotency by range", () => {
    const rangeId = insertSummaryRange(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevRangeId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Query by exact range
    const existing = getSummaryRangeByRange(TEST_DATA_DIR, testSessionId, 1, 3);
    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(rangeId);

    // Different range should return null
    const notFound = getSummaryRangeByRange(TEST_DATA_DIR, testSessionId, 2, 4);
    expect(notFound).toBeNull();
  });
});

describe("Turn kind column", () => {
  const KIND_TEST_DATA_DIR = "/tmp/vsh-test-turn-kind";

  beforeEach(() => {
    const db = getDbForDataDir(KIND_TEST_DATA_DIR);
    db.delete(turns).run();
    db.delete(sessions).run();

    // Create a test session
    createSession({
      id: "test-session-kind",
      title: "Test Kind",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    }, KIND_TEST_DATA_DIR);
  });

  it("should default to 'turn' kind", () => {
    const db = getDbForDataDir(KIND_TEST_DATA_DIR);
    const result = db
      .insert(turns)
      .values({
        sessionId: "test-session-kind",
        turnNumber: 1,
        userContent: "test",
        userTimestamp: new Date().toISOString(),
        status: "success",
        success: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      .returning({ id: turns.id, kind: turns.kind })
      .get();

    expect(result?.kind).toBe("turn");
  });

  it("should allow 'summary' kind", () => {
    const db = getDbForDataDir(KIND_TEST_DATA_DIR);
    const result = db
      .insert(turns)
      .values({
        sessionId: "test-session-kind",
        turnNumber: 1,
        userContent: "test",
        userTimestamp: new Date().toISOString(),
        status: "success",
        success: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        kind: "summary",
      })
      .returning({ id: turns.id, kind: turns.kind })
      .get();

    expect(result?.kind).toBe("summary");
  });
});

describe("Pending summary guards", () => {
  const GUARD_DATA_DIR = "/tmp/vsh-test-summary-guards";
  const SID = "test-session-guards";

  function insertSummary(
    turnNumber: number,
    status: string,
    startedAtIso: string,
    meta: Record<string, unknown> | null = null,
  ): number {
    const db = getDbForDataDir(GUARD_DATA_DIR);
    const row = db
      .insert(turns)
      .values({
        sessionId: SID,
        turnNumber,
        userContent: "placeholder",
        userTimestamp: startedAtIso,
        status,
        success: status === "success" ? 1 : 0,
        startedAt: startedAtIso,
        completedAt: status === "success" ? startedAtIso : null,
        kind: "summary",
        configSnapshotJson: meta ? JSON.stringify(meta) : null,
      })
      .returning({ id: turns.id })
      .get();
    return row!.id;
  }

  beforeEach(() => {
    const db = getDbForDataDir(GUARD_DATA_DIR);
    db.delete(stepParts).run();
    db.delete(steps).run();
    db.delete(subagentSpawns).run();
    db.delete(summaryRanges).run();
    db.delete(turns).run();
    db.delete(sessions).run();
    createSession(
      { id: SID, title: "Guards", created: new Date().toISOString(), updated: new Date().toISOString() },
      GUARD_DATA_DIR,
    );
  });

  it("getPendingSummaryTurns returns only pending summary turns", () => {
    insertSummary(1, "pending", new Date().toISOString());
    insertSummary(2, "success", new Date().toISOString());
    insertSummary(3, "pending", new Date().toISOString());
    const pending = getPendingSummaryTurns(GUARD_DATA_DIR, SID);
    expect(pending.map((s) => s.turnNumber).sort()).toEqual([1, 3]);
  });

  it("markSummaryTurnError flips a pending turn to error", () => {
    const id = insertSummary(1, "pending", new Date().toISOString());
    markSummaryTurnError(GUARD_DATA_DIR, id);
    const row = getDbForDataDir(GUARD_DATA_DIR)
      .select({ status: turns.status, success: turns.success })
      .from(turns)
      .where(eq(turns.id, id))
      .get();
    expect(row?.status).toBe("error");
    expect(row?.success).toBe(false);
  });

  it("expireStaleSummaryPlaceholders marks only rows older than the threshold", () => {
    insertSummary(1, "pending", new Date(Date.now() - 10 * 60_000).toISOString()); // stale
    insertSummary(2, "pending", new Date().toISOString()); // fresh
    const expired = expireStaleSummaryPlaceholders(GUARD_DATA_DIR, SID, 5 * 60_000);
    expect(expired).toHaveLength(1);
    const remaining = getPendingSummaryTurns(GUARD_DATA_DIR, SID);
    expect(remaining.map((s) => s.turnNumber)).toEqual([2]);
  });

  it("insertSubagentSpawn records a summary spawn edge (idempotent by toolCallId)", () => {
    // A summary turn + its display step exist in the parent session.
    const summaryTurnId = insertSummary(1, "success", new Date().toISOString());
    const db = getDbForDataDir(GUARD_DATA_DIR);
    const step = db
      .insert(steps)
      .values({
        sessionId: SID,
        turnId: summaryTurnId,
        stepIndex: 0,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      .returning({ id: steps.id })
      .get();
    const childSessionId = "child-summary-1";
    createSession(
      { id: childSessionId, title: "Summary", kind: "subagent", parentId: SID, created: new Date().toISOString(), updated: new Date().toISOString() },
      GUARD_DATA_DIR,
    );
    const childTurn = db
      .insert(turns)
      .values({
        sessionId: childSessionId,
        turnNumber: 1,
        userContent: "transcript",
        userTimestamp: new Date().toISOString(),
        status: "success",
        success: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalTokens: 500,
      })
      .returning({ id: turns.id })
      .get();

    insertSubagentSpawn({
      parentSessionId: SID,
      parentTurnId: summaryTurnId,
      parentTurnNumber: 1,
      parentStepId: step!.id,
      parentStepIndex: 0,
      toolCallId: "summary-42",
      childSessionId,
      childTurnId: childTurn!.id,
      childTurnNumber: 1,
      kind: "spawn",
      taskLabel: "Summary: turns 1-2",
    }, GUARD_DATA_DIR);

    const edge = getSpawnByToolCallId("summary-42", GUARD_DATA_DIR);
    expect(edge?.childSessionId).toBe(childSessionId);
    expect(edge?.childTurnNumber).toBe(1);
    expect(edge?.parentTurnId).toBe(summaryTurnId);
    expect(edge?.taskLabel).toBe("Summary: turns 1-2");
  });
});
