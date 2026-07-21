import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import {
  createHooksSystem,
  setHooksSystem,
  buildHookContext,
  type HooksSystem,
} from "./index";
import { createRegistry, type ResolveContext } from "../tools/registry";
import type { ToolDef } from "../tools/types";

describe("hooks wire: tool registry", () => {
  let system: HooksSystem;

  beforeEach(() => {
    system = createHooksSystem();
    setHooksSystem(system);
  });

  afterEach(() => {
    setHooksSystem(null);
  });

  test("permission allow -> tool.before -> execute -> tool.after", async () => {
    const order: string[] = [];
    system.bus.on(
      "tool.before",
      () => {
        order.push("before");
      },
      { id: "t.before", priority: 10 }
    );
    system.bus.on(
      "tool.after",
      () => {
        order.push("after");
      },
      { id: "t.after", priority: 10 }
    );

    const def: ToolDef = {
      name: "ping",
      description: "ping",
      inputSchema: z.object({}),
      permissionDefault: "allow",
      execute: async () => {
        order.push("execute");
        return { title: "ping", output: "pong" };
      },
    };

    const reg = createRegistry();
    reg.register(def);
    const hookCtx = buildHookContext({
      dataDir: "/tmp",
      source: "internal",
      sessionId: "s1",
      turnId: "t1",
    });
    const resolveCtx: ResolveContext = {
      dataDir: "/tmp",
      sessionId: "s1",
      workspaceRoot: "/ws",
    };
    const tools = await reg.toFilteredAiSdkTools((callId) => ({
      sessionId: "s1",
      workspaceRoot: "/ws",
      dataDir: "/tmp",
      abortSignal: new AbortController().signal,
      callId,
      hookCtx,
      askPermission: async () => true,
    }), resolveCtx);

    const out = await tools.ping!.execute!({}, {
      toolCallId: "call-1",
      messages: [],
    } as never);

    expect(out).toBe("pong");
    expect(order).toEqual(["before", "execute", "after"]);
  });

  test("tool.before cancel skips execute", async () => {
    system.bus.on(
      "tool.before",
      () => ({ cancel: true, cancelReason: "blocked" }),
      { id: "block", priority: 1 }
    );

    let executed = false;
    const def: ToolDef = {
      name: "danger",
      description: "danger",
      inputSchema: z.object({}),
      permissionDefault: "allow",
      execute: async () => {
        executed = true;
        return { title: "danger", output: "nope" };
      },
    };

    const reg = createRegistry();
    reg.register(def);
    const hookCtx = buildHookContext({
      dataDir: "/tmp",
      source: "internal",
      turnId: "t2",
    });
    const resolveCtx: ResolveContext = {
      dataDir: "/tmp",
      sessionId: "s1",
      workspaceRoot: "/ws",
    };
    const tools = await reg.toFilteredAiSdkTools((callId) => ({
      sessionId: "s1",
      workspaceRoot: "/ws",
      dataDir: "/tmp",
      abortSignal: new AbortController().signal,
      callId,
      hookCtx,
      askPermission: async () => true,
    }), resolveCtx);

    const out = await tools.danger!.execute!({}, {
      toolCallId: "call-2",
      messages: [],
    } as never);

    expect(executed).toBe(false);
    expect(String(out)).toContain("cancelled");
    expect(String(out)).toContain("blocked");
  });

  test("tool throw emits tool.error", async () => {
    const errors: string[] = [];
    system.bus.on(
      "tool.error",
      (_ctx, p) => {
        errors.push(p.error);
      },
      { id: "err", priority: 1 }
    );

    const def: ToolDef = {
      name: "boom",
      description: "boom",
      inputSchema: z.object({}),
      permissionDefault: "allow",
      execute: async () => {
        throw new Error("kaboom");
      },
    };

    const reg = createRegistry();
    reg.register(def);
    const hookCtx = buildHookContext({
      dataDir: "/tmp",
      source: "internal",
      turnId: "t3",
    });
    const resolveCtx: ResolveContext = {
      dataDir: "/tmp",
      sessionId: "s1",
      workspaceRoot: "/ws",
    };
    const tools = await reg.toFilteredAiSdkTools((callId) => ({
      sessionId: "s1",
      workspaceRoot: "/ws",
      dataDir: "/tmp",
      abortSignal: new AbortController().signal,
      callId,
      hookCtx,
      askPermission: async () => true,
    }), resolveCtx);

    const out = await tools.boom!.execute!({}, {
      toolCallId: "call-3",
      messages: [],
    } as never);

    expect(String(out)).toContain("kaboom");
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("kaboom");
  });
});
