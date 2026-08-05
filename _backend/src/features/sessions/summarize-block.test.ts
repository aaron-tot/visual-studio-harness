import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { sessions, turns, summaryBlocks } from "../../db/schema";
import {
  createSession,
  getSession,
  insertSummaryBlock,
  getLatestSummaryBlock,
  getEarliestLiveSummaryBlock,
  getSummaryBlockByRange,
  getSummaryBlocksForSession,
} from "./db";

const TEST_DATA_DIR = "/tmp/vsh-test-summarize-block";

describe("Summary Blocks", () => {
  let testSessionId: string;

  beforeEach(() => {
    // Clean up any existing test data
    const db = getDbForDataDir(TEST_DATA_DIR);
    db.delete(summaryBlocks).run();
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
    db.delete(summaryBlocks).run();
    db.delete(turns).run();
    db.delete(sessions).run();
  });

  it("should create and retrieve a summary block", () => {
    const blockId = insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 123,
      startTurn: 1,
      endTurn: 3,
      prevBlockId: null,
      originalTokens: 2400,
      summaryTokens: 300,
      createdAt: new Date().toISOString(),
    });

    expect(blockId).toBeGreaterThan(0);

    const blocks = getSummaryBlocksForSession(TEST_DATA_DIR, testSessionId);
    expect(blocks.length).toBe(1);
    expect(blocks[0].id).toBe(blockId);
    expect(blocks[0].sessionId).toBe(testSessionId);
    expect(blocks[0].summaryTurnId).toBe(123);
    expect(blocks[0].startTurn).toBe(1);
    expect(blocks[0].endTurn).toBe(3);
    expect(blocks[0].prevBlockId).toBeNull();
    expect(blocks[0].originalTokens).toBe(2400);
    expect(blocks[0].summaryTokens).toBe(300);
  });

  it("should chain multiple summary blocks", () => {
    // First block
    const block1Id = insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 101,
      startTurn: 1,
      endTurn: 3,
      prevBlockId: null,
      originalTokens: 2400,
      summaryTokens: 300,
      createdAt: new Date().toISOString(),
    });

    // Second block references first
    const block2Id = insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 102,
      startTurn: 4,
      endTurn: 5,
      prevBlockId: block1Id,
      originalTokens: 1200,
      summaryTokens: 200,
      createdAt: new Date().toISOString(),
    });

    const blocks = getSummaryBlocksForSession(TEST_DATA_DIR, testSessionId);
    expect(blocks.length).toBe(2);

    // Check chain
    const block2 = blocks.find(b => b.id === block2Id);
    expect(block2?.prevBlockId).toBe(block1Id);

    const block1 = blocks.find(b => b.id === block1Id);
    expect(block1?.prevBlockId).toBeNull();
  });

  it("should get latest summary block by endTurn", () => {
    insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevBlockId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 2,
      startTurn: 4,
      endTurn: 5,
      prevBlockId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    const latest = getLatestSummaryBlock(TEST_DATA_DIR, testSessionId);
    expect(latest).not.toBeNull();
    expect(latest?.endTurn).toBe(5); // highest endTurn
  });

  it("should get earliest live summary block at slider position", () => {
    // Block 1: covers turns 1-3
    insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevBlockId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Block 2: covers turns 4-5 (after slider at turn 4)
    insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 2,
      startTurn: 4,
      endTurn: 5,
      prevBlockId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Slider at turn 4 - should get block 1 (endTurn=3 <= 4)
    const liveBlock = getEarliestLiveSummaryBlock(TEST_DATA_DIR, testSessionId, 4);
    expect(liveBlock?.endTurn).toBe(3);

    // Slider at turn 3 - exact match
    const liveBlock2 = getEarliestLiveSummaryBlock(TEST_DATA_DIR, testSessionId, 3);
    expect(liveBlock2?.endTurn).toBe(3);
  });

  it("should check idempotency by range", () => {
    const blockId = insertSummaryBlock(TEST_DATA_DIR, {
      sessionId: testSessionId,
      summaryTurnId: 1,
      startTurn: 1,
      endTurn: 3,
      prevBlockId: null,
      originalTokens: 100,
      summaryTokens: 50,
      createdAt: new Date().toISOString(),
    });

    // Query by exact range
    const existing = getSummaryBlockByRange(TEST_DATA_DIR, testSessionId, 1, 3);
    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(blockId);

    // Different range should return null
    const notFound = getSummaryBlockByRange(TEST_DATA_DIR, testSessionId, 2, 4);
    expect(notFound).toBeNull();
  });
});

describe("Turn kind column", () => {
  const TEST_DATA_DIR = "/tmp/vsh-test-turn-kind";

  beforeEach(() => {
    const db = getDbForDataDir(TEST_DATA_DIR);
    db.delete(turns).run();
    db.delete(sessions).run();

    // Create a test session
    createSession({
      id: "test-session-kind",
      title: "Test Kind",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    }, TEST_DATA_DIR);
  });

  it("should default to 'turn' kind", () => {
    const db = getDbForDataDir(TEST_DATA_DIR);
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
    const db = getDbForDataDir(TEST_DATA_DIR);
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
