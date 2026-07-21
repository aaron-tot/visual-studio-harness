import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDbForDataDir } from "../../db/client";
import {
  insertSubagentSpawn,
  listSpawnsForSession,
  listSpawnsForTurn,
  getSpawnByToolCallId,
  getLatestChildTurn,
  resolveParentStepForToolCall,
  recordSubagentSpawnEdge,
  computeInclusiveTotalTokens,
} from "./db";
import { createSession } from "../sessions/db";
import { eq } from "drizzle-orm";
import { turns } from "../../db/schema";
import { createTurn, createStep, insertStepPart, finalizeStep, finalizeTurnTrace } from "../chat/db-trace";

const PARENT_SESSION = "test-spawn-parent";
const CHILD_SESSION = "test-spawn-child";

let dataDir: string;

beforeAll(async () => {
  const base = join(tmpdir(), `VISUAL STUDIO HARNESS-spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions", PARENT_SESSION), { recursive: true });
  await mkdir(join(dataDir, "sessions", CHILD_SESSION), { recursive: true });

  getDbForDataDir(dataDir);

  createSession(
    {
      id: PARENT_SESSION,
      title: "parent",
      providerName: "test",
      modelName: "test",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    dataDir
  );
  createSession(
    {
      id: CHILD_SESSION,
      title: "child",
      providerName: "test",
      modelName: "test",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      kind: "subagent",
      parentId: PARENT_SESSION,
    },
    dataDir
  );
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

function makeSpawnData(overrides: Partial<Parameters<typeof insertSubagentSpawn>[0]> = {}) {
  return {
    parentSessionId: PARENT_SESSION,
    parentTurnId: 1,
    parentTurnNumber: 1,
    parentStepId: 1,
    parentStepIndex: 0,
    toolCallId: "tc-1",
    childSessionId: CHILD_SESSION,
    childTurnId: 1,
    childTurnNumber: 1,
    kind: "spawn" as const,
    taskLabel: "test task",
    ...overrides,
  };
}

describe("subagent_spawns DB", () => {
  test("insert and list spawns for session", () => {
    const id = insertSubagentSpawn(makeSpawnData(), dataDir);
    expect(id).toBeGreaterThan(0);

    const rows = listSpawnsForSession(PARENT_SESSION, dataDir);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find((r) => r.id === id);
    expect(found).toBeDefined();
    expect(found!.toolCallId).toBe("tc-1");
    expect(found!.kind).toBe("spawn");
    expect(found!.childSessionId).toBe(CHILD_SESSION);
  });

  test("resume inserts second edge with same child", () => {
    const id = insertSubagentSpawn(
      makeSpawnData({
        toolCallId: "tc-2",
        parentTurnId: 1,
        parentStepIndex: 1,
        childTurnId: 2,
        childTurnNumber: 2,
        kind: "resume",
        taskLabel: "continue task",
      }),
      dataDir
    );
    expect(id).toBeGreaterThan(0);

    const rows = listSpawnsForTurn(1, dataDir);
    const resumeRows = rows.filter((r) => r.kind === "resume");
    expect(resumeRows.length).toBe(1);
    expect(resumeRows[0].toolCallId).toBe("tc-2");
    expect(resumeRows[0].childTurnNumber).toBe(2);
  });

  test("list spawns for turn returns N edges for N tasks", () => {
    const rows = listSpawnsForTurn(1, dataDir);
    // tc-1 and tc-2 were inserted for turn 1
    expect(rows.length).toBe(2);
  });

  test("get spawn by tool call id", () => {
    const row = getSpawnByToolCallId("tc-1", dataDir);
    expect(row).not.toBeNull();
    expect(row!.toolCallId).toBe("tc-1");
    expect(row!.kind).toBe("spawn");

    const missing = getSpawnByToolCallId("nonexistent", dataDir);
    expect(missing).toBeNull();
  });

  test("upsert by toolCallId is idempotent", () => {
    const id1 = insertSubagentSpawn(
      makeSpawnData({
        toolCallId: "tc-upsert",
        childTurnNumber: 1,
        childTurnId: 10,
      }),
      dataDir
    );
    const id2 = insertSubagentSpawn(
      makeSpawnData({
        toolCallId: "tc-upsert",
        childTurnNumber: 2,
        childTurnId: 20,
        kind: "resume",
      }),
      dataDir
    );
    // Same row updated
    expect(id2).toBe(id1);
    const row = getSpawnByToolCallId("tc-upsert", dataDir);
    expect(row!.childTurnNumber).toBe(2);
    expect(row!.childTurnId).toBe(20);
    expect(row!.kind).toBe("resume");
    // Still a single edge for this tool call
    const all = listSpawnsForSession(PARENT_SESSION, dataDir).filter(
      (r) => r.toolCallId === "tc-upsert"
    );
    expect(all.length).toBe(1);
  });

  test("getLatestChildTurn returns the latest completed turn", () => {
    createTurn(CHILD_SESSION, 1, "hello", new Date().toISOString(), {}, dataDir);
    createTurn(CHILD_SESSION, 2, "world", new Date().toISOString(), {}, dataDir);

    const latest = getLatestChildTurn(CHILD_SESSION, dataDir);
    expect(latest).not.toBeNull();
    expect(latest!.turnNumber).toBe(2);
  });

  test("resolveParentStepForToolCall resolves correct step info", () => {
    const turnId = createTurn(
      PARENT_SESSION,
      99,
      "test resolve",
      new Date().toISOString(),
      {},
      dataDir
    );
    const stepId = createStep(turnId, PARENT_SESSION, 3, {}, dataDir);
    insertStepPart(
      PARENT_SESSION,
      turnId,
      stepId,
      "tool",
      { toolCallId: "tc-resolve" },
      1,
      "running",
      { toolCallId: "tc-resolve", toolName: "task" },
      dataDir
    );

    const info = resolveParentStepForToolCall(PARENT_SESSION, "tc-resolve", dataDir);
    expect(info).not.toBeNull();
    expect(info!.turnId).toBe(turnId);
    expect(info!.turnNumber).toBe(99);
    expect(info!.stepId).toBe(stepId);
    expect(info!.stepIndex).toBe(3);
  });
});

describe("recordSubagentSpawnEdge (full write path)", () => {
  test("records edge from parent tool part + latest child turn", () => {
    const turnId = createTurn(
      PARENT_SESSION,
      50,
      "parent asks task",
      new Date().toISOString(),
      { modelName: "parent-model" },
      dataDir
    );
    const stepId = createStep(turnId, PARENT_SESSION, 0, {}, dataDir);
    // Parent own usage — must not be touched by spawn edge
    finalizeStep(
      stepId,
      {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      dataDir
    );
    finalizeTurnTrace(turnId, { success: true }, dataDir);

    insertStepPart(
      PARENT_SESSION,
      turnId,
      stepId,
      "tool",
      { toolCallId: "tc-live-1", toolName: "task" },
      1,
      "completed",
      { toolCallId: "tc-live-1", toolName: "task" },
      dataDir
    );

    // Child turn that the subagent just ran
    const childTurnId = createTurn(
      CHILD_SESSION,
      10,
      "child work",
      new Date().toISOString(),
      {},
      dataDir
    );
    finalizeStep(
      createStep(childTurnId, CHILD_SESSION, 0, {}, dataDir),
      {
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
      },
      dataDir
    );
    finalizeTurnTrace(childTurnId, { success: true }, dataDir);

    const spawnId = recordSubagentSpawnEdge({
      parentSessionId: PARENT_SESSION,
      toolCallId: "tc-live-1",
      childSessionId: CHILD_SESSION,
      kind: "spawn",
      taskLabel: "do the thing",
      dataDir,
    });
    expect(spawnId).not.toBeNull();
    expect(spawnId!).toBeGreaterThan(0);

    const edge = getSpawnByToolCallId("tc-live-1", dataDir);
    expect(edge).not.toBeNull();
    expect(edge!.parentTurnId).toBe(turnId);
    expect(edge!.parentTurnNumber).toBe(50);
    expect(edge!.parentStepId).toBe(stepId);
    expect(edge!.parentStepIndex).toBe(0);
    expect(edge!.childSessionId).toBe(CHILD_SESSION);
    expect(edge!.childTurnId).toBe(childTurnId);
    expect(edge!.childTurnNumber).toBe(10);
    expect(edge!.kind).toBe("spawn");
    expect(edge!.taskLabel).toBe("do the thing");

    // Parent turn own tokens unchanged by edge write
    const parentTurn = getDbForDataDir(dataDir)
      .select()
      .from(turns)
      .where(eq(turns.id, turnId))
      .get();
    expect(parentTurn?.totalTokens).toBe(120);
    expect(parentTurn?.inputTokens).toBe(100);
  });

  test("returns null and does not throw when parent tool part missing", () => {
    const id = recordSubagentSpawnEdge({
      parentSessionId: PARENT_SESSION,
      toolCallId: "tc-no-part",
      childSessionId: CHILD_SESSION,
      kind: "spawn",
      dataDir,
    });
    expect(id).toBeNull();
    expect(getSpawnByToolCallId("tc-no-part", dataDir)).toBeNull();
  });

  test("records cancel-style edge when child session known", () => {
    const turnId = createTurn(
      PARENT_SESSION,
      51,
      "parent cancelled mid-task",
      new Date().toISOString(),
      {},
      dataDir
    );
    const stepId = createStep(turnId, PARENT_SESSION, 0, {}, dataDir);
    insertStepPart(
      PARENT_SESSION,
      turnId,
      stepId,
      "tool",
      { toolCallId: "tc-cancel" },
      1,
      "running",
      { toolCallId: "tc-cancel", toolName: "task" },
      dataDir
    );

    const id = recordSubagentSpawnEdge({
      parentSessionId: PARENT_SESSION,
      toolCallId: "tc-cancel",
      childSessionId: CHILD_SESSION,
      kind: "spawn",
      taskLabel: "cancelled task",
      dataDir,
    });
    expect(id).not.toBeNull();
    const edge = getSpawnByToolCallId("tc-cancel", dataDir);
    expect(edge!.childSessionId).toBe(CHILD_SESSION);
    // Latest child turn still resolved (turn 10 from previous test)
    expect(edge!.childTurnNumber).toBe(10);
  });
});

describe("computeInclusiveTotalTokens", () => {
  test("returns own when no children", () => {
    expect(computeInclusiveTotalTokens(100, [])).toBe(100);
  });

  test("sums own plus child owns", () => {
    expect(computeInclusiveTotalTokens(100, [50, 30])).toBe(180);
  });

  test("works with large numbers", () => {
    expect(computeInclusiveTotalTokens(1500, [500, 2000, 1000])).toBe(5000);
  });
});
