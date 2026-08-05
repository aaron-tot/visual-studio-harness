import { tool, type ToolSet } from "ai";
import type { BaseToolContext, ToolDef, ToolResult } from "./types";
import type { ToolExecutionMode } from "../../../../_shared/types/config";
import { ToolExecutor } from "./executor";
import { resolveToolPermissionDetailed, type ResolveContext } from "./perms/resolve";

/**
 * Simple promise-chain mutex. Chains executions so only one runs at a time.
 * Works naturally with SDK's Promise.all since each call chains onto lastPromise.
 */
class SequentialMutex {
  private lastPromise = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lastPromise.then(async () => fn(), async () => fn());
    this.lastPromise = next.catch(() => { /* swallow errors — next tool runs regardless */ });
    return next;
  }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    this.tools.set(def.name, def);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * Build AI SDK tool set, pre-filtering denied tools.
   * The model never sees tools whose effective permission is "deny".
   * resolveCtx provides the session/workspace/global context for permission resolution.
   *
   * Execution lifecycle (inside ToolExecutor.run):
   *   permission resolve → ask UI → tool.before → execute → tool.after | tool.error
   *
   * When mode is "sequential", all tool executes share a promise-chain mutex so
   * only one tool runs at a time in SDK's Promise.all. Default is "sequential".
   */
  async toFilteredAiSdkTools(
    ctxFactory: (callId: string) => BaseToolContext,
    resolveCtx: ResolveContext,
    mode?: ToolExecutionMode,
  ): Promise<ToolSet> {
    const executor = new ToolExecutor();
    const mutex = mode === "concurrent" ? null : new SequentialMutex();
    const out: ToolSet = {};
    for (const def of this.tools.values()) {
      const resolved = await resolveToolPermissionDetailed(def.name, resolveCtx);
      const mode = resolved.mode === "deny" && resolved.layer === "none" ? def.permissionDefault : resolved.mode;
      if (mode === "deny") continue;

      const preResolved = resolved.mode === "ask" ? undefined : resolved.mode;
      out[def.name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (args, options) => {
          const ctx = ctxFactory(options.toolCallId);
          const run = () => executor.run(def, args, ctx, preResolved);
          return mutex ? mutex.run(run) : run();
        },
      });
    }
    return out;
  }
}

/**
 * Prepare a ToolResult for return to the AI SDK.
 *
 * When `_stopTurn` is set, the full ToolResult object must reach the SDK
 * so the flag survives in the tool-result event.  For normal results,
 * return just the output string.
 *
 * NOTE: this silently drops `_stopTurn`-like properties in the normal
 * path.  If you add new flags to `ToolResult` that need to reach the SDK,
 * add a check here first.
 */
export function toolResultForSdk(result: ToolResult): string | ToolResult {
  if (result._stopTurn) return result;
  return result.output;
}

export function createRegistry(): ToolRegistry {
  return new ToolRegistry();
}
