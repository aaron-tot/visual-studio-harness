import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isPendingAutoCompaction, AutoCompactionBlockedError, getLastContextTokenUsage, validModelRefParts } from "./auto-compaction";
import { getDbForDataDir } from "../../db/client";
import { createSession } from "../sessions/db";
import { createTurn, createStep, finalizeStep, finalizeTurnTrace } from "./db-trace";

const SESSION_ID = "test-auto-compaction";

let dataDir: string;

beforeAll(async () => {
  const base = join(tmpdir(), `vsh-auto-compaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  dataDir = join(base, "data");
  await mkdir(dataDir, { recursive: true });

  // Enable global auto compaction with a generous trigger so we can prove the
  // resolved `used` comes from the latest STEP, not the aggregated turn.
  await writeFile(
    join(dataDir, "context-config.json"),
    JSON.stringify({
      global: {
        mode: "fixed",
        autoCompactionEnabled: true,
        autoCompactionTriggerTokens: 250000,
      },
    }),
  );

  getDbForDataDir(dataDir);
  createSession(
    { id: SESSION_ID, title: "auto-compaction test", providerName: "test", modelName: "test", created: new Date().toISOString(), updated: new Date().toISOString() },
    dataDir,
  );
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

describe("AutoCompactionBlockedError", () => {
  test("is an Error and carries a message", () => {
    const err = new AutoCompactionBlockedError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AutoCompactionBlockedError);
    expect(err.name).toBe("AutoCompactionBlockedError");
    expect(err.message).toBe("boom");
  });
});

describe("validModelRefParts", () => {
  test("splits a plain provider/model ref", () => {
    expect(validModelRefParts("OpenCode Zen/nemotron-3-ultra-free"))
      .toEqual({ providerName: "OpenCode Zen", modelName: "nemotron-3-ultra-free" });
  });

  test("accepts a provider whose model id itself contains slashes (Openrouter vendor/model)", () => {
    expect(validModelRefParts("Openrouter/deepseek/deepseek-v4-flash-0731"))
      .toEqual({ providerName: "Openrouter", modelName: "deepseek/deepseek-v4-flash-0731" });
  });

  test("rejects missing model", () => {
    expect(validModelRefParts("Openrouter/")).toBeNull();
  });

  test("rejects missing provider", () => {
    expect(validModelRefParts("/deepseek-v4-flash-0731")).toBeNull();
  });

  test("rejects null / empty", () => {
    expect(validModelRefParts(null)).toBeNull();
    expect(validModelRefParts("")).toBeNull();
  });
});

describe("isPendingAutoCompaction", () => {
  const base = {
    enabled: true,
    triggerTokens: 1000,
    lastInputTokens: 1000,
    lastTurnNumber: 5,
    latestSummaryEndTurn: null as number | null,
  };

  test("disabled is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, enabled: false })).toBe(false);
  });

  test("zero / missing trigger is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, triggerTokens: 0 })).toBe(false);
    expect(isPendingAutoCompaction({ ...base, triggerTokens: -1 })).toBe(false);
  });

  test("under threshold is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, lastInputTokens: 999 })).toBe(false);
  });

  test("at threshold with no covering summary is pending", () => {
    expect(isPendingAutoCompaction(base)).toBe(true);
  });

  test("above threshold with no covering summary is pending", () => {
    expect(isPendingAutoCompaction({ ...base, lastInputTokens: 2500 })).toBe(true);
  });

  test("summary that ends on the last live turn is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 5 })).toBe(false);
  });

  test("summary that ends after the last live turn is not pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 6 })).toBe(false);
  });

  test("summary that ends before the last live turn is still pending", () => {
    expect(isPendingAutoCompaction({ ...base, latestSummaryEndTurn: 4 })).toBe(true);
  });
});

describe("getLastContextTokenUsage resolves from the latest STEP, not the turn aggregate", () => {
  test("uses the latest step's context (turn input_tokens sum would over-count)", () => {
    // One live turn with two steps: the turn's aggregated input_tokens
    // (sum of both steps) is wildly above the 250k trigger, while the latest
    // step's own context is small. The header/trigger must use the step.
    const turnId = createTurn(SESSION_ID, 1, "seed", new Date().toISOString(), undefined, dataDir);
    const s1 = createStep(turnId, SESSION_ID, 0, undefined, dataDir);
    finalizeStep(s1, { inputTokens: 1800000, cacheReadTokens: 100000 }, dataDir);
    const s2 = createStep(turnId, SESSION_ID, 1, undefined, dataDir);
    finalizeStep(s2, { inputTokens: 90000, cacheReadTokens: 10_000_000 }, dataDir);
    finalizeTurnTrace(turnId, { success: true, finishReason: "stop" }, dataDir, [
      { inputTokens: 1800000, cacheReadTokens: 100000 },
      { inputTokens: 90000, cacheReadTokens: 10_000_000 },
    ] as any);

    const ctx = getLastContextTokenUsage(dataDir, SESSION_ID);
    expect(ctx).not.toBeNull();
    // Latest step's context = input_tokens only (already includes cached).
    // cachedTokens are a sub-slice of input; adding them would double-count.
    expect(ctx!.used).toBe(90000);
    expect(ctx!.pending).toBe(false);
  });

  test("at/over the threshold on the latest step input is pending", () => {
    const turnId = createTurn(SESSION_ID, 2, "seed2", new Date().toISOString(), undefined, dataDir);
    const s = createStep(turnId, SESSION_ID, 0, undefined, dataDir);
    finalizeStep(s, { inputTokens: 260000, cacheReadTokens: 2500000 }, dataDir);
    finalizeTurnTrace(turnId, { success: true, finishReason: "stop" }, dataDir, [
      { inputTokens: 260000, cacheReadTokens: 2500000 },
    ] as any);

    const ctx = getLastContextTokenUsage(dataDir, SESSION_ID);
    expect(ctx).not.toBeNull();
    // 260000 >= 250000 trigger → pending (will fire before next message).
    // The huge cachedReadTokens sub-slice must NOT push it even higher.
    expect(ctx!.used).toBe(260000);
    expect(ctx!.pending).toBe(true);
  });
});
