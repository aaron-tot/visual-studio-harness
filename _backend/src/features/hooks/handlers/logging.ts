import type { HookBus } from "../bus";

/**
 * Optional debug logging. Only registers when VISUAL_STUDIO_HARNESS_HOOKS_LOG=1|true.
 * Skips stream.chunk (too noisy).
 */
export function registerLoggingHandler(bus: HookBus): void {
  const v = process.env.VISUAL_STUDIO_HARNESS_HOOKS_LOG;
  if (v !== "1" && v !== "true") return;

  const log = (event: string, ctx: { turnId: string; sessionId?: string }, extra?: unknown) => {
    console.debug(
      `[hooks:log] ${event} turn=${ctx.turnId} session=${ctx.sessionId ?? "-"}`,
      extra ?? ""
    );
  };

  bus.on(
    "turn.start",
    (ctx, p) => {
      log("turn.start", ctx, { sessionId: p.sessionId, workspace: p.workspaceRoot });
    },
    { id: "builtin.logging.turn.start", priority: 0 }
  );

  bus.on(
    "turn.complete",
    (ctx, p) => {
      log("turn.complete", ctx, { durationMs: p.durationMs });
    },
    { id: "builtin.logging.turn.complete", priority: 0 }
  );

  bus.on(
    "turn.error",
    (ctx, p) => {
      log("turn.error", ctx, { error: p.error, durationMs: p.durationMs });
    },
    { id: "builtin.logging.turn.error", priority: 0 }
  );

  bus.on(
    "tool.before",
    (ctx, p) => {
      log("tool.before", ctx, { tool: p.toolName, callId: p.toolCallId });
    },
    { id: "builtin.logging.tool.before", priority: 0 }
  );

  bus.on(
    "tool.after",
    (ctx, p) => {
      log("tool.after", ctx, { tool: p.toolName, isError: p.isError });
    },
    { id: "builtin.logging.tool.after", priority: 0 }
  );

  bus.on(
    "tool.error",
    (ctx, p) => {
      log("tool.error", ctx, { tool: p.toolName, error: p.error });
    },
    { id: "builtin.logging.tool.error", priority: 0 }
  );

  bus.on(
    "session.abort",
    (ctx, p) => {
      log("session.abort", ctx, { reason: p.reason });
    },
    { id: "builtin.logging.session.abort", priority: 0 }
  );
}
