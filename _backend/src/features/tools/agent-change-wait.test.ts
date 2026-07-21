import { describe, expect, test, beforeEach } from "bun:test";
import {
  waitForAgentChange,
  resolveAgentChange,
  cancelAgentChangeRequests,
} from "./agent-change-wait";

beforeEach(() => {
  cancelAgentChangeRequests();
});

describe("resolveAgentChange", () => {
  test("resolves pending waiter with switch", async () => {
    const promise = waitForAgentChange("req-1", 5000);
    const ok = resolveAgentChange("req-1", {
      action: "switch",
      agentName: "sub",
    });
    expect(ok).toBe(true);
    const result = await promise;
    expect(result.action).toBe("switch");
    expect(result.agentName).toBe("sub");
  });

  test("resolves pending waiter with continue", async () => {
    const promise = waitForAgentChange("req-2", 5000);
    resolveAgentChange("req-2", { action: "continue" });
    const result = await promise;
    expect(result.action).toBe("continue");
  });

  test("resolves pending waiter with stop", async () => {
    const promise = waitForAgentChange("req-3", 5000);
    resolveAgentChange("req-3", { action: "stop" });
    const result = await promise;
    expect(result.action).toBe("stop");
  });

  test("returns false for unknown requestId", () => {
    const ok = resolveAgentChange("unknown", { action: "stop" });
    expect(ok).toBe(false);
  });

  test("replaces existing waiter on duplicate requestId", async () => {
    const p1 = waitForAgentChange("req-dup", 5000);
    const p2 = waitForAgentChange("req-dup", 5000);
    resolveAgentChange("req-dup", { action: "continue" });
    // Old waiter resolves to "stop" when replaced
    const r1 = await p1;
    const r2 = await p2;
    expect(r1.action).toBe("stop");
    expect(r2.action).toBe("continue");
  });
});

describe("cancelAgentChangeRequests", () => {
  test("resolves all pending with stop", async () => {
    const p1 = waitForAgentChange("req-a", 5000);
    const p2 = waitForAgentChange("req-b", 5000);
    cancelAgentChangeRequests();
    const r1 = await p1;
    const r2 = await p2;
    expect(r1.action).toBe("stop");
    expect(r2.action).toBe("stop");
  });

  test("no-op when nothing pending", () => {
    cancelAgentChangeRequests();
    const ok = resolveAgentChange("gone", { action: "stop" });
    expect(ok).toBe(false);
  });
});

describe("waitForAgentChange timeout", () => {
  test("resolves to stop on timeout", async () => {
    const promise = waitForAgentChange("req-timeout", 50);
    const result = await promise;
    expect(result.action).toBe("stop");
  });
});
