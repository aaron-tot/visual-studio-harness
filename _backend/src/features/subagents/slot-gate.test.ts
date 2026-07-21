import { describe, expect, test } from "bun:test";
import {
  ensureLlmSlotAvailable,
  normalizeSlotGateSettings,
} from "./slot-gate";
import type { ProviderConfig } from "../../../../_shared/types";

const provider: ProviderConfig = {
  displayName: "Local",
  baseUrl: "http://127.0.0.1:9", // nothing listening
  models: [{ displayName: "m", modelName: "m" }],
};

describe("normalizeSlotGateSettings", () => {
  test("defaults", () => {
    const s = normalizeSlotGateSettings({});
    expect(s.policy).toBe("ask");
    expect(s.pollIntervalSec).toBe(5);
    expect(s.waitTimeoutSec).toBe(300);
  });
});

describe("ensureLlmSlotAvailable", () => {
  test("fail policy returns error when unreachable/no free slots", async () => {
    const out = await ensureLlmSlotAvailable({
      provider,
      settings: { policy: "fail", pollIntervalSec: 1, waitTimeoutSec: 1 },
      requestId: "r1",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/no free slots|unreachable|slots/i);
    }
  });

  test("wait policy times out", async () => {
    const started = Date.now();
    const out = await ensureLlmSlotAvailable({
      provider,
      settings: { policy: "wait", pollIntervalSec: 1, waitTimeoutSec: 2 },
      requestId: "r2",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/Timed out|no free|unreachable/i);
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
  }, 15000);

  test("ask + fail decision", async () => {
    const out = await ensureLlmSlotAvailable({
      provider,
      settings: { policy: "ask", pollIntervalSec: 1, waitTimeoutSec: 1 },
      requestId: "r3",
      askUser: async () => ({ action: "fail" }),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/Try again later|no free|unreachable/i);
    }
  });

  test("force timeout while waiting returns no-slots error", async () => {
    const { forceSlotWaitTimeout } = await import("./slot-wait-control");
    const started = Date.now();
    const p = ensureLlmSlotAvailable({
      provider,
      settings: { policy: "wait", pollIntervalSec: 5, waitTimeoutSec: 60 },
      requestId: "force-me",
    });
    // Give register a tick, then force
    await new Promise((r) => setTimeout(r, 50));
    expect(forceSlotWaitTimeout("force-me")).toBe(true);
    const out = await p;
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/no free slots/i);
      expect(out.error).toMatch(/Try again later/i);
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
