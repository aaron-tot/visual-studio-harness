import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { sessions } from "../../db/schema";
import { createSession } from "../sessions/db";
import {
  createTurn,
  createStep,
  finalizeStep,
  finalizeTurnTrace,
  insertStepPart,
  insertTurnContext,
} from "./db-trace";
import { insertSubagentSpawn } from "../subagents/db";
import { buildUsageTree, buildTurnStepsTree, getSessionOwnTokens } from "./usage-tree";

let dataDir: string;

beforeAll(async () => {
  const base = join(
    tmpdir(),
    `vsh-usage-tree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

describe("buildUsageTree", () => {
  test("returns null for missing session", () => {
    expect(buildUsageTree("no-such-session", dataDir)).toBeNull();
  });

  test("empty session has zero own and inclusive", () => {
    seedSession("empty-s");
    const tree = buildUsageTree("empty-s", dataDir);
    expect(tree).not.toBeNull();
    expect(tree!.sessionId).toBe("empty-s");
    expect(tree!.own.totalTokens).toBe(0);
    expect(tree!.inclusive.totalTokens).toBe(0);
    expect(tree!.turns).toEqual([]);
    expect(tree!.turnCount).toBe(0);
    expect(tree!.stepCount).toBe(0);
  });

  test("own tokens from turns when cache empty; contextTurnNumbers; inclusive with spawn; shallow steps", () => {
    seedSession("p1", { title: "Parent One" });
    seedSession("c1", { kind: "subagent", parentId: "p1", title: "Child One" });

    const now = new Date().toISOString();
    const t1 = createTurn("p1", 1, "hello parent", now, { modelName: "m-parent" }, dataDir);
    const s0 = createStep(t1, "p1", 0, { modelId: "m-parent", providerName: "prov" }, dataDir);
    finalizeStep(
      s0,
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, stepTimeMs: 100 },
      dataDir,
    );
    insertStepPart(
      "p1",
      t1,
      s0,
      "tool",
      { toolCallId: "tc-p1" },
      1,
      "completed",
      { toolCallId: "tc-p1", toolName: "task" },
      dataDir,
    );
    finalizeTurnTrace(t1, { success: true }, dataDir);

    const t2 = createTurn("p1", 2, "second", now, { modelName: "m-parent" }, dataDir);
    insertTurnContext(t2, [t1], dataDir);
    const s1 = createStep(t2, "p1", 0, {}, dataDir);
    finalizeStep(
      s1,
      { inputTokens: 20, outputTokens: 10, totalTokens: 30, stepTimeMs: 200 },
      dataDir,
    );
    finalizeTurnTrace(t2, { success: true }, dataDir);

    const ct = createTurn("c1", 1, "child work", now, { modelName: "m-child" }, dataDir);
    const cs = createStep(ct, "c1", 0, { modelId: "m-child" }, dataDir);
    finalizeStep(
      cs,
      { inputTokens: 100, outputTokens: 50, totalTokens: 150, stepTimeMs: 500 },
      dataDir,
    );
    finalizeTurnTrace(ct, { success: true }, dataDir);

    insertSubagentSpawn(
      {
        parentSessionId: "p1",
        parentTurnId: t1,
        parentTurnNumber: 1,
        parentStepId: s0,
        parentStepIndex: 0,
        toolCallId: "tc-p1",
        childSessionId: "c1",
        childTurnId: ct,
        childTurnNumber: 1,
        kind: "spawn",
        taskLabel: "research",
      },
      dataDir,
    );

    const tree = buildUsageTree("p1", dataDir)!;
    expect(tree.sessionId).toBe("p1");
    expect(tree.label).toBe("Parent One");
    // own = sum of parent turns (15+30)
    expect(tree.own.totalTokens).toBe(45);
    // inclusive = own + child session own 150
    expect(tree.inclusive.totalTokens).toBe(195);
    expect(tree.turnCount).toBe(2);
    expect(tree.inclusiveTurnCount).toBe(3);
    expect(tree.stepCount).toBe(2);
    expect(tree.inclusiveStepCount).toBe(3);

    expect(tree.turns).toHaveLength(2);
    const turn1 = tree.turns[0];
    expect(turn1.turnId).toBe(t1);
    expect(turn1.turnNumber).toBe(1);
    expect(turn1.contextTurnNumbers).toEqual([]);
    expect(turn1.own.totalTokens).toBe(15);
    expect(turn1.inclusive.totalTokens).toBe(165); // 15 + child turn 150
    expect(turn1.stepCount).toBe(1);
    expect(turn1.steps).toEqual([]); // shallow: steps omitted

    const turn2 = tree.turns[1];
    expect(turn2.contextTurnNumbers).toEqual([1]);
    expect(turn2.own.totalTokens).toBe(30);
    expect(turn2.inclusive.totalTokens).toBe(30);
    expect(turn2.steps).toEqual([]);
  });

  test("buildTurnStepsTree returns step-level spawn stubs (child unset) with usage columns only", () => {
    seedSession("ts-p", { title: "Parent" });
    seedSession("ts-c", { kind: "subagent", parentId: "ts-p", title: "Child" });

    const now = new Date().toISOString();
    const t1 = createTurn("ts-p", 1, "turn one", now, { modelName: "m-p" }, dataDir);
    const s0 = createStep(t1, "ts-p", 0, { modelId: "m-p", providerName: "prov" }, dataDir);
    finalizeStep(
      s0,
      { inputTokens: 10, outputTokens: 5, totalTokens: 15, stepTimeMs: 100 },
      dataDir,
    );
    finalizeTurnTrace(t1, { success: true }, dataDir);

    const ct = createTurn("ts-c", 1, "child", now, { modelName: "m-c" }, dataDir);
    const cs = createStep(ct, "ts-c", 0, { modelId: "m-c" }, dataDir);
    finalizeStep(
      cs,
      { inputTokens: 100, outputTokens: 50, totalTokens: 150, stepTimeMs: 500 },
      dataDir,
    );
    finalizeTurnTrace(ct, { success: true }, dataDir);

    insertSubagentSpawn(
      {
        parentSessionId: "ts-p",
        parentTurnId: t1,
        parentTurnNumber: 1,
        parentStepId: s0,
        parentStepIndex: 0,
        toolCallId: "tc-ts",
        childSessionId: "ts-c",
        childTurnId: ct,
        childTurnNumber: 1,
        kind: "spawn",
        taskLabel: "child-task",
      },
      dataDir,
    );

    const tree = buildTurnStepsTree("ts-p", 1, dataDir)!;
    expect(tree.turnId).toBe(t1);
    expect(tree.turnNumber).toBe(1);
    expect(tree.own.totalTokens).toBe(15);
    expect(tree.inclusive.totalTokens).toBe(165); // 15 + child turn 150
    expect(tree.steps).toHaveLength(1);
    const step = tree.steps![0];
    expect(step.stepIndex).toBe(0);
    expect(step.modelId).toBe("m-p");
    expect(step.own.totalTokens).toBe(15);
    expect(step.inclusive.totalTokens).toBe(165);
    expect(step.subagents).toHaveLength(1);
    const sa = step.subagents![0];
    expect(sa.childSessionId).toBe("ts-c");
    expect(sa.taskLabel).toBe("child-task");
    expect(sa.kind).toBe("spawn");
    expect(sa.own.totalTokens).toBe(150);
    expect(sa.inclusive.totalTokens).toBe(150);
    expect(sa.child).toBeUndefined(); // stubs carry no nested child tree
  });

  test("getSessionOwnTokens falls back to turn SUM when cache is zero", () => {
    seedSession("cache-fb");
    const now = new Date().toISOString();
    const t = createTurn("cache-fb", 1, "x", now, {}, dataDir);
    const st = createStep(t, "cache-fb", 0, {}, dataDir);
    finalizeStep(st, { inputTokens: 7, outputTokens: 3, totalTokens: 10 }, dataDir);
    finalizeTurnTrace(t, { success: true }, dataDir);
    // Clear cache to force fallback to SUM(turns)
    getDbForDataDir(dataDir)
      .update(sessions)
      .set({
        cachedInputTokens: 0,
        cachedOutputTokens: 0,
        cachedTotalTokens: 0,
      })
      .where(eq(sessions.id, "cache-fb"))
      .run();

    const own = getSessionOwnTokens("cache-fb", dataDir);
    expect(own.totalTokens).toBe(10);
    expect(own.inputTokens).toBe(7);
  });

  test("cycle guard: parentId loop does not infinite recurse", () => {
    seedSession("loop-a", { parentId: "loop-b" });
    seedSession("loop-b", { parentId: "loop-a" });
    // Should return without hanging
    const tree = buildUsageTree("loop-a", dataDir);
    expect(tree).not.toBeNull();
    expect(tree!.sessionId).toBe("loop-a");
  });
});
