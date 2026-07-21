import type { BaseToolContext, ToolDef, ToolResult } from "./types";
import { toolResultForSdk } from "./registry";
import { SandboxError } from "./sandbox";
import { getBus } from "../hooks/get-bus";
import { resolveToolPermission } from "./perms/resolve";

/**
 * Encapsulates the tool execution lifecycle:
 *   permission resolve → ask UI → tool.before → execute → tool.after | tool.error
 *
 * Used by ToolRegistry.toFilteredAiSdkTools() and test helpers.
 */
export class ToolExecutor {
  async run(
    def: ToolDef,
    args: unknown,
    ctx: BaseToolContext
  ): Promise<string | ToolResult> {
    let toolArgs: unknown = args;
    try {
      // 1. Permission resolve
      const mode = await resolveToolPermission(def.name, {
        dataDir: ctx.dataDir,
        sessionId: ctx.sessionId,
        workspaceRoot: ctx.workspaceRoot,
      });
      if (mode === "deny") {
        return toolResultForSdk({
          title: def.name,
          output: `ERROR permission: tool '${def.name}' is denied`,
          isError: true,
        });
      }

      // 2. Interactive ask
      if (mode === "ask") {
        const ok = await ctx.askPermission(def.name, toolArgs);
        if (!ok) {
          return toolResultForSdk({
            title: def.name,
            output: `ERROR permission: tool '${def.name}' was denied by user`,
            isError: true,
          });
        }
      }

      // 3. Hook before
      const bus = ctx.hookCtx ? getBus() : null;
      if (bus && ctx.hookCtx) {
        const outcome = await bus.emitIntercept("tool.before", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
        });
        if (outcome.cancelled) {
          const reason = outcome.reason ?? "cancelled by hook";
          return toolResultForSdk({
            title: def.name,
            output: `ERROR hook: tool '${def.name}' cancelled: ${reason}`,
            isError: true,
          });
        }
        if (outcome.patch.args !== undefined) {
          toolArgs = outcome.patch.args;
        }
      }

      // 4. Execute
      const result = await def.execute(toolArgs as never, { ...ctx, toolName: def.name });
      const output = toolResultForSdk(result);

      // 5. Hook after / error
      if (bus && ctx.hookCtx) {
        await bus.emit("tool.after", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
          output,
          isError: result.isError,
        });
        if (result.isError) {
          await bus.emit("tool.error", ctx.hookCtx, {
            toolName: def.name,
            toolCallId: ctx.callId,
            args: toolArgs,
            error: result.output,
          });
        }
      }

      return output;
    } catch (err: unknown) {
      const message =
        err instanceof SandboxError
          ? err.message
          : err instanceof Error
            ? `ERROR ${def.name}: ${err.message}`
            : `ERROR ${def.name}: unknown error`;

      const bus = ctx.hookCtx ? getBus() : null;
      if (bus && ctx.hookCtx) {
        await bus.emit("tool.error", ctx.hookCtx, {
          toolName: def.name,
          toolCallId: ctx.callId,
          args: toolArgs,
          error: message,
        });
      }

      return toolResultForSdk({
        title: def.name,
        output: message,
        isError: true,
      });
    }
  }
}
