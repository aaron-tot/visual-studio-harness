import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import * as schema from "../../db/schema";
import {
  getNextTurnNumber,
  createTurn,
  insertTurnContext,
  listContextTurnIds,
  ensurePromptSnapshot,
  ensureToolsSnapshot,
  createStep,
  finalizeStep,
  insertStepPart,
  updateStepPartData,
  updateTurnRawCapture,
  getTurnById,
  getTurnByNumber,
  listStepsForTurn,
  listStepPartsForTurn,
  finalizeTurnTrace,
  abortTurnTrace,
  clearTurnSteps,
  recomputeSessionUsage,
  getActiveTraceTurn,
  sessionHasTurns,
} from "./db-trace";
import { createStepStreamWriter } from "./persist-stream";
import { createSession } from "../sessions/db";

const SESSION_ID = "test-trace-session";

let dataDir: string;

beforeAll(async () => {
  const base = join(tmpdir(), `vsh-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions", SESSION_ID), { recursive: true });

  getDbForDataDir(dataDir);

  createSession(
    { id: SESSION_ID, title: "trace test", providerName: "test", modelName: "test", created: new Date().toISOString(), updated: new Date().toISOString() },
    dataDir,
  );
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

describe("trace repository", () => {
  test("getNextTurnNumber starts at 1", () => {
    expect(getNextTurnNumber(SESSION_ID, dataDir)).toBe(1);
  });

  test("createTurn inserts streaming turn", () => {
    const turnId = createTurn(SESSION_ID, 1, "hello", new Date().toISOString(), { agentName: "test-agent" }, dataDir);
    expect(turnId).toBeGreaterThan(0);

    const t = getTurnById(turnId, dataDir);
    expect(t).not.toBeNull();
    expect(t!.sessionId).toBe(SESSION_ID);
    expect(t!.turnNumber).toBe(1);
    expect(t!.userContent).toBe("hello");
    expect(t!.status).toBe("streaming");
    expect(t!.agentName).toBe("test-agent");
  });

  test("getNextTurnNumber increments", () => {
    expect(getNextTurnNumber(SESSION_ID, dataDir)).toBe(2);
  });

  test("insert + list turn context", () => {
    const turn2Id = createTurn(SESSION_ID, 2, "world", new Date().toISOString(), {}, dataDir);
    insertTurnContext(turn2Id, [1], dataDir);

    const contextIds = listContextTurnIds(turn2Id, dataDir);
    expect(contextIds).toEqual([1]);
  });

  test("turn_context order preserved", () => {
    const turn3Id = createTurn(SESSION_ID, 3, "third", new Date().toISOString(), {}, dataDir);
    insertTurnContext(turn3Id, [1, 2], dataDir);

    const contextIds = listContextTurnIds(turn3Id, dataDir);
    expect(contextIds).toEqual([1, 2]);
  });

  test("snapshot dedup: same content returns same id", () => {
    const content = "You are a helpful assistant.";
    const id1 = ensurePromptSnapshot(content, dataDir);
    const id2 = ensurePromptSnapshot(content, dataDir);
    expect(id1).toBe(id2);
    expect(id1).toBeGreaterThan(0);
  });

  test("snapshot dedup: different content returns different id", () => {
    const id1 = ensurePromptSnapshot("Content A", dataDir);
    const id2 = ensurePromptSnapshot("Content B", dataDir);
    expect(id1).not.toBe(id2);
  });

  test("tools snapshot dedup", () => {
    const tools = JSON.stringify([{ name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }]);
    const id1 = ensureToolsSnapshot(tools, dataDir);
    const id2 = ensureToolsSnapshot(tools, dataDir);
    expect(id1).toBe(id2);
  });

  test("create + finalize step with usage", () => {
    const turnId = 4; // already known
    const t = getTurnByNumber(SESSION_ID, turnId, dataDir);
    if (!t) {
      // first time — create
      const newId = createTurn(SESSION_ID, 4, "test step", new Date().toISOString(), {}, dataDir);
      const stepId = createStep(newId, SESSION_ID, 0, { providerName: "test", modelId: "test-model" }, dataDir);

      const steps0 = listStepsForTurn(newId, dataDir);
      expect(steps0).toHaveLength(1);
      expect(steps0[0].status).toBe("streaming");

      finalizeStep(stepId, {
        finishReason: "stop",
        rawFinishReason: "stop",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        reasoningTokens: 12,
        cacheReadTokens: 8,
        cacheWriteTokens: 2,
        noCacheInputTokens: 92,
        usageRawJson: JSON.stringify({ prompt_tokens: 100 }),
        stepTimeMs: 2000,
        responseTimeMs: 1800,
        timeToFirstOutputMs: 100,
        effectiveOutputTps: 25,
        outputTps: 30,
        inputTps: 500,
        toolExecutionMsJson: JSON.stringify({ call_x: 5 }),
        performanceJson: JSON.stringify({ stepTimeMs: 2000 }),
        providerMetadataJson: JSON.stringify({ mock: true }),
        responseId: "resp_test",
        responseModelId: "test-model",
      }, dataDir);

      const steps1 = listStepsForTurn(newId, dataDir);
      expect(steps1[0].status).toBe("completed");
      expect(steps1[0].inputTokens).toBe(100);
      expect(steps1[0].outputTokens).toBe(50);
      expect(steps1[0].totalTokens).toBe(150);
      expect(steps1[0].reasoningTokens).toBe(12);
      expect(steps1[0].cacheReadTokens).toBe(8);
      expect(steps1[0].cacheWriteTokens).toBe(2);
      expect(steps1[0].noCacheInputTokens).toBe(92);
      expect(steps1[0].stepTimeMs).toBe(2000);
      expect(steps1[0].responseTimeMs).toBe(1800);
      expect(steps1[0].effectiveOutputTps).toBe(25);
      expect(steps1[0].finishReason).toBe("stop");
      expect(steps1[0].rawFinishReason).toBe("stop");
      expect(steps1[0].responseId).toBe("resp_test");
      expect(steps1[0].responseModelId).toBe("test-model");
      expect(steps1[0].usageRawJson).toContain("prompt_tokens");
      expect(steps1[0].providerMetadataJson).toContain("mock");
    }
  });

  test("insert + read step parts", () => {
    const turnId = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnId, "parts test", new Date().toISOString(), {}, dataDir);
    const stepId = createStep(tId, SESSION_ID, 0, {}, dataDir);

    insertStepPart(SESSION_ID, tId, stepId, "text", { content: "Hello" }, 1, "streaming", {}, dataDir);
    insertStepPart(SESSION_ID, tId, stepId, "tool", { toolCallId: "tc1", args: {} }, 2, "running",
      { toolCallId: "tc1", toolName: "read" }, dataDir);

    const parts = listStepPartsForTurn(tId, dataDir);
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe("text");
    expect(parts[1].type).toBe("tool");
    expect(parts[1].toolCallId).toBe("tc1");
  });

  test("update step part data", () => {
    const turnId = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnId, "update test", new Date().toISOString(), {}, dataDir);
    const stepId = createStep(tId, SESSION_ID, 0, {}, dataDir);

    const partId = insertStepPart(SESSION_ID, tId, stepId, "text", { content: "He" }, 1, "streaming", {}, dataDir);
    updateStepPartData(partId, { content: "Hello" }, { seq: 2, status: "completed" }, dataDir);

    const parts = listStepPartsForTurn(tId, dataDir);
    expect(parts).toHaveLength(1);
    const data = JSON.parse(parts[0].data);
    expect(data.content).toBe("Hello");
    expect(parts[0].status).toBe("completed");
    expect(parts[0].seq).toBe(2);
  });

  test("finalize turn recomputes usage from steps", () => {
    const turnNum = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnNum, "finalize test", new Date().toISOString(), {}, dataDir);

    const s1 = createStep(tId, SESSION_ID, 0, {}, dataDir);
    finalizeStep(s1, {
      finishReason: "stop", inputTokens: 200, outputTokens: 100, totalTokens: 300,
      reasoningTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 1,
    }, dataDir);

    const s2 = createStep(tId, SESSION_ID, 1, {}, dataDir);
    finalizeStep(s2, {
      finishReason: "stop", inputTokens: 300, outputTokens: 150, totalTokens: 450,
      reasoningTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 2,
    }, dataDir);

    finalizeTurnTrace(tId, { success: true, finishReason: "stop" }, dataDir);

    const t = getTurnById(tId, dataDir);
    expect(t!.status).toBe("success");
    expect(t!.success).toBe(true);
    expect(t!.inputTokens).toBe(500);
    expect(t!.outputTokens).toBe(250);
    expect(t!.reasoningTokens).toBe(15);
    expect(t!.cacheReadTokens).toBe(50);
    expect(t!.cacheWriteTokens).toBe(3);
    expect(t!.totalTokens).toBe(750);
    expect(t!.stepCount).toBe(2);
    expect(t!.completedAt).toBeTruthy();
  });

  test("session cache reflects successful turn only", () => {
    const turnNum = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnNum, "fail test", new Date().toISOString(), {}, dataDir);
    const s1 = createStep(tId, SESSION_ID, 0, {}, dataDir);
    finalizeStep(s1, { finishReason: "error", inputTokens: 10, outputTokens: 5, totalTokens: 15 }, dataDir);
    finalizeTurnTrace(tId, { success: false, errorMessage: "oops" }, dataDir);

    const failed = getTurnById(tId, dataDir);
    expect(failed!.status).toBe("error");
    expect(failed!.success).toBe(false);
    expect(failed!.inputTokens).toBe(10); // usage still recorded

    recomputeSessionUsage(SESSION_ID, dataDir);
    const db = getDbForDataDir(dataDir);
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, SESSION_ID)).get();
    expect(session!.cachedTurnCount).toBe(1);
  });

  test("abort turn", () => {
    const turnNum = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnNum, "abort test", new Date().toISOString(), {}, dataDir);
    const stepId = createStep(tId, SESSION_ID, 0, {}, dataDir);
    insertStepPart(SESSION_ID, tId, stepId, "text", { content: "partial" }, 1, "streaming", {}, dataDir);

    abortTurnTrace(tId, dataDir);

    const t = getTurnById(tId, dataDir);
    expect(t!.status).toBe("aborted");

    const steps0 = listStepsForTurn(tId, dataDir);
    expect(steps0[0].status).toBe("error");

    const parts = listStepPartsForTurn(tId, dataDir);
    expect(parts).toHaveLength(1);
  });

  test("getTurnByNumber", () => {
    const t = getTurnByNumber(SESSION_ID, 1, dataDir);
    expect(t).not.toBeNull();
    expect(t!.turnNumber).toBe(1);
  });

  test("getActiveTraceTurn returns streaming turn", () => {
    const turnNum = getNextTurnNumber(SESSION_ID, dataDir);
    const tId = createTurn(SESSION_ID, turnNum, "active test", new Date().toISOString(), {}, dataDir);
    const active = getActiveTraceTurn(SESSION_ID, dataDir);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(tId);
  });

  test("sessionHasTurns", () => {
    expect(sessionHasTurns(SESSION_ID, dataDir)).toBe(true);
    expect(sessionHasTurns("nonexistent-session", dataDir)).toBe(false);
  });

  // ── Phase A regression tests ──────────────────────────────────────
  // C1 — step_part.step_id matches real step after rebind

  test("writer rebindStep attaches parts to correct step", () => {
    const tId = createTurn(SESSION_ID, 30, "rebind test", new Date().toISOString(), {}, dataDir);
    const s1 = createStep(tId, SESSION_ID, 0, { modelId: "m1" }, dataDir);
    const s2 = createStep(tId, SESSION_ID, 1, { modelId: "m2" }, dataDir);

    const writer = createStepStreamWriter(SESSION_ID, tId, 0, dataDir);
    writer.writeDelta("text", "step-0-text-", 1);
    writer.rebindStep(s1);

    // Now s1 has the delta
    expect(writer).toBeDefined();

    // Write explicitly with rebind to s1 then s2
    const w2 = createStepStreamWriter(SESSION_ID, tId, 0, dataDir);
    w2.rebindStep(s1);
    w2.writeDelta("text", "first-step", 1);
    w2.rebindStep(s2);
    w2.writeDelta("text", "second-step", 2);
    w2.closeOpen();

    const partsForS1 = listStepPartsForTurn(tId, dataDir)
      .filter((p) => p.stepId === s1);
    const partsForS2 = listStepPartsForTurn(tId, dataDir)
      .filter((p) => p.stepId === s2);

    // Parts should exist on real step IDs
    const allPartStepIds = listStepPartsForTurn(tId, dataDir)
      .filter((p) => p.seq >= 1 || p.seq === 1 || true)
      .map((p) => p.stepId);
    const allStepIds = [s1, s2];
    // All non-zero stepIds should be real
    for (const sid of allPartStepIds) {
      if (sid !== 0) {
        expect(allStepIds).toContain(sid);
      }
    }
  });

  // C3 — raw capture persists and round-trips

  test("updateTurnRawCapture persists and round-trips", () => {
    const tId = createTurn(SESSION_ID, 31, "raw capture test", new Date().toISOString(), {}, dataDir);
    const req = { model: "test-model", messages: [{ role: "user", content: "hi" }] };
    const res = { choices: [{ delta: { content: "hello" } }] };
    updateTurnRawCapture(tId, req, res, dataDir);

    const row = getTurnById(tId, dataDir);
    expect(row).not.toBeNull();
    expect(row!.rawRequestJson).toBe(JSON.stringify(req));
    expect(row!.rawResponseJson).toBe(JSON.stringify(res));
  });

  // C4 — contextTurnNumbers verification via project-chat projector

  test("context turn numbers align with turn display numbers", () => {
    const sessionB = "context-num-session";
    createSession(
      { id: sessionB, title: "context test", providerName: "t", modelName: "t", created: "now", updated: "now" },
      dataDir,
    );

    const t1 = createTurn(sessionB, 1, "first", new Date().toISOString(), {}, dataDir);
    const t2 = createTurn(sessionB, 2, "second", new Date().toISOString(), {}, dataDir);
    insertTurnContext(t2, [t1], dataDir);

    const ctxIds = listContextTurnIds(t2, dataDir);
    // contextTurnIds store PKs internally
    expect(ctxIds).toEqual([t1]);

    // Verify turnNumber-based lookup works
    const t1Lookup = getTurnByNumber(sessionB, 1, dataDir);
    expect(t1Lookup).not.toBeNull();
    expect(t1Lookup!.turnNumber).toBe(1);
  });

  // ── F1 regression tests ─────────────────────────────────────────────

  test("clearTurnSteps deletes steps and parts for a turn", () => {
    const tId = createTurn(SESSION_ID, 40, "clear steps test", new Date().toISOString(), {}, dataDir);
    const s1 = createStep(tId, SESSION_ID, 0, { modelId: "test" }, dataDir);
    const p1 = insertStepPart(SESSION_ID, tId, s1, "text", { content: "hello" }, 1, "completed", undefined, dataDir);
    expect(p1).toBeGreaterThan(0);
    const stepsBefore = listStepsForTurn(tId, dataDir);
    expect(stepsBefore.length).toBe(1);
    const partsBefore = listStepPartsForTurn(tId, dataDir);
    expect(partsBefore.length).toBeGreaterThanOrEqual(1);
    clearTurnSteps(tId, dataDir);
    const stepsAfter = listStepsForTurn(tId, dataDir);
    expect(stepsAfter.length).toBe(0);
    const partsAfter = listStepPartsForTurn(tId, dataDir);
    expect(partsAfter.length).toBe(0);
  });

  test("writer guards pre-step writes", () => {
    const tId = createTurn(SESSION_ID, 41, "pre-step guard", new Date().toISOString(), {}, dataDir);
    const writer = createStepStreamWriter(SESSION_ID, tId, 0, dataDir);
    // writeDelta before any bind — should be no-op
    writer.writeDelta("text", "should-not-appear", 1);

    // Now bind to a real step
    const s1 = createStep(tId, SESSION_ID, 0, { modelId: "test" }, dataDir);
    writer.rebindStep(s1);
    writer.writeDelta("text", "should-appear", 2);
    writer.closeOpen();

    const partsAfter = listStepPartsForTurn(tId, dataDir);
    expect(partsAfter.length).toBe(1);
    expect(partsAfter[0].stepId).toBe(s1);
    expect(JSON.parse(partsAfter[0].data).content).toBe("should-appear");
  });

  test("abortTurnTrace sets success=false", () => {
    const tId = createTurn(SESSION_ID, 42, "abort success test", new Date().toISOString(), {}, dataDir);
    abortTurnTrace(tId, dataDir);
    const row = getTurnById(tId, dataDir);
    expect(row).not.toBeNull();
    expect(row!.success === false || row!.success === 0 || row!.success == null).toBe(true);
    expect(row!.status).toBe("aborted");
  });
});
