import { describe, expect, test, beforeEach } from "bun:test";
import { createHookBus } from "./bus";
import { buildHookContext } from "./context";
import {
  listActiveHooks,
  listReservedHooks,
  getCatalogEntry,
  isInterceptHook,
} from "./catalog";
import type { HookContext } from "./types";

function ctx(): HookContext {
  return buildHookContext({
    dataDir: "/tmp/vsh-hooks-test",
    source: "internal",
    turnId: "turn-test-1",
    sessionId: "sess-1",
  });
}

describe("catalog", () => {
  test("active and reserved sets are non-empty and disjoint", () => {
    const active = listActiveHooks();
    const reserved = listReservedHooks();
    expect(active.length).toBeGreaterThan(0);
    expect(reserved.length).toBeGreaterThan(0);
    for (const name of reserved) {
      expect(active).not.toContain(name);
    }
  });

  test("tool.before is intercept; turn.start is observe", () => {
    expect(isInterceptHook("tool.before")).toBe(true);
    expect(getCatalogEntry("turn.start")?.kind).toBe("observe");
  });
});

describe("HookBus", () => {
  let bus: ReturnType<typeof createHookBus>;

  beforeEach(() => {
    bus = createHookBus();
  });

  test("priority: lower runs first", async () => {
    const order: string[] = [];
    bus.on(
      "turn.start",
      () => {
        order.push("high");
      },
      { id: "a-high", priority: 200 }
    );
    bus.on(
      "turn.start",
      () => {
        order.push("low");
      },
      { id: "b-low", priority: 10 }
    );
    bus.on(
      "turn.start",
      () => {
        order.push("mid");
      },
      { id: "c-mid", priority: 100 }
    );

    await bus.emit("turn.start", ctx(), {
      sessionId: "s",
      created: true,
      meta: {
        id: "s",
        title: "t",
        providerName: "p",
        modelName: "m",
        created: "",
        updated: "",
      },
      workspaceRoot: "/ws",
    });

    expect(order).toEqual(["low", "mid", "high"]);
  });

  test("handler throw does not stop later handlers", async () => {
    const order: string[] = [];
    bus.on(
      "session.abort",
      () => {
        order.push("first");
        throw new Error("boom");
      },
      { id: "thrower", priority: 1 }
    );
    bus.on(
      "session.abort",
      () => {
        order.push("second");
      },
      { id: "survivor", priority: 2 }
    );

    await bus.emit("session.abort", ctx(), {
      sessionId: "s",
      reason: "user_cancel",
    });

    expect(order).toEqual(["first", "second"]);
  });

  test("emitIntercept: first cancel wins", async () => {
    bus.on(
      "tool.before",
      () => ({ cancel: true, cancelReason: "nope" }),
      { id: "deny", priority: 1 }
    );
    let ran = false;
    bus.on(
      "tool.before",
      () => {
        ran = true;
      },
      { id: "after-deny", priority: 2 }
    );

    const outcome = await bus.emitIntercept("tool.before", ctx(), {
      toolName: "bash",
      toolCallId: "c1",
      args: {},
    });

    expect(outcome.cancelled).toBe(true);
    expect(outcome.reason).toBe("nope");
    expect(ran).toBe(false);
  });

  test("emitIntercept: handler throw is fail-open (does not cancel)", async () => {
    bus.on(
      "tool.before",
      () => {
        throw new Error("handler crash");
      },
      { id: "crash", priority: 1 }
    );
    bus.on(
      "tool.before",
      () => ({ patch: { note: "ok" } }),
      { id: "ok", priority: 2 }
    );

    const outcome = await bus.emitIntercept("tool.before", ctx(), {
      toolName: "read",
      toolCallId: "c2",
      args: { path: "a.ts" },
    });

    expect(outcome.cancelled).toBe(false);
    expect(outcome.patch).toEqual({ note: "ok" });
  });

  test("same id replaces previous handler", async () => {
    const calls: number[] = [];
    bus.on(
      "stream.end",
      () => {
        calls.push(1);
      },
      { id: "same", priority: 10 }
    );
    bus.on(
      "stream.end",
      () => {
        calls.push(2);
      },
      { id: "same", priority: 10 }
    );

    expect(bus.listenerCount("stream.end")).toBe(1);
    await bus.emit("stream.end", ctx(), {
      fullContent: "hi",
      partCount: 0,
      durationMs: 1,
    });
    expect(calls).toEqual([2]);
  });

  test("off removes handler by id", async () => {
    let n = 0;
    bus.on(
      "message.received",
      () => {
        n++;
      },
      { id: "once", priority: 1 }
    );
    bus.off("message.received", "once");
    await bus.emit("message.received", ctx(), { content: "x" });
    expect(n).toBe(0);
  });

  test("reserved emit is no-op (no throw, no handlers run)", async () => {
    let ran = false;
    bus.on(
      "history.truncated",
      () => {
        ran = true;
      },
      { id: "should-not-run", priority: 1 }
    );

    await bus.emit("history.truncated", ctx(), {
      sessionId: "s",
      truncatedTurnCount: 3,
    });

    expect(ran).toBe(false);
  });

  test("on without id throws", () => {
    expect(() => {
      // @ts-expect-error intentional missing id
      bus.on("turn.error", () => {}, {});
    }).toThrow(/id is required/);
  });
});

describe("createHooksSystem", () => {
  test("boots and can register extra handlers", async () => {
    const { createHooksSystem } = await import("./system");
    const system = createHooksSystem();
    let seen = false;
    system.bus.on(
      "session.abort",
      () => {
        seen = true;
      },
      { id: "test", priority: 50 }
    );
    await system.bus.emit("session.abort", ctx(), {
      sessionId: "s",
      reason: "other",
    });
    expect(seen).toBe(true);
  });
});
