import type { ModelMessage, PrepareStepFunction, ToolSet } from "ai";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";
import { buildAdditionalSystemInfoBlock } from "../system-prompt/builder";

/** Fabricated tool name for the trailing `additional_system_info` injection. */
export const ADDITIONAL_SYSTEM_INFO_TOOL = "additional_system_info";

/** True when a model message is a `tool` result for the `additional_system_info` injection. */
export function isAdditionalSystemInfoResult(m: ModelMessage): boolean {
  if (m.role !== "tool") return false;
  const c = m.content;
  if (!Array.isArray(c)) return false;
  return c.some((p) => (p as any)?.type === "tool-result" && (p as any)?.toolName === ADDITIONAL_SYSTEM_INFO_TOOL);
}

export interface PerStepRebuildContext {
  dataDir: string;
  workspaceRoot: string;
  sessionId: string;
  mode: string;
  noSystemPrompt: boolean;
  agentSettings: unknown;
  systemPromptJoiners?: unknown;
  workspaceManifest?: unknown;
  graphService?: WorkspaceGraphService;
  /** Which volatile sections are rendered into the injection (default: all three). */
  additionalSystemInfoSections?: readonly string[];
  /** When true, a timestamp is appended so content always changes each step. */
  additionalSystemInfoIncludeTime?: boolean;
  /** Timestamp used for the very first step so it matches the turn-initial block. */
  turnStartNow: Date;
  /** Called after each emission so callers can snapshot base(+injection) per step. */
  onBlockBuilt?: (stepNumber: number, block: string) => void;
  /** Persist an emitted injection (see run-turn wiring). */
  persist?: (injection: { toolCallId: string; toolName: string; content: string }) => void;
}

/**
 * Builds a `prepareStep` hook for the AI SDK that injects the volatile
 * `additional_system_info` block (fabricated `assistant tool_call` + `tool result`
 * pair) at the tail of the outgoing `messages` — **only when its content changed**
 * since the last emitted injection (append-only, never removes). The base
 * `instructions` (real `system`) is built once per turn by run-turn and is never
 * overridden here, so the stable leading prefix stays byte-identical for cache.
 */
export function createPerStepPrepareStep(ctx: PerStepRebuildContext): PrepareStepFunction<ToolSet> {
  return async ({ messages, stepNumber }) => {
    if (ctx.noSystemPrompt) return {};

    const content = await buildAdditionalSystemInfoBlock({
      dataDir: ctx.dataDir,
      workspaceRoot: ctx.workspaceRoot,
      mode: ctx.mode,
      sessionId: ctx.sessionId,
      noSystemPrompt: ctx.noSystemPrompt,
      agentSettings: ctx.agentSettings,
      systemPromptJoiners: ctx.systemPromptJoiners,
      workspaceManifest: ctx.workspaceManifest,
      graphService: ctx.graphService,
      now: stepNumber === 0 ? ctx.turnStartNow : new Date(),
      turnStart: ctx.turnStartNow,
    }, ctx.additionalSystemInfoSections, ctx.additionalSystemInfoIncludeTime);
    if (!content) return {}; // empty resolved block ⇒ skip

    // Last emitted content already present in the outgoing messages?
    const last = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!isAdditionalSystemInfoResult(m)) continue;
        const c = m.content;
        if (Array.isArray(c)) {
          const p = c.find((x) => (x as any)?.type === "tool-result");
          const val = (p as any)?.output;
          const out = val && typeof val === "object" ? (val as any).value : val;
          return typeof out === "string" ? out : "";
        }
        return "";
      }
      return null; // none present
    })();
    if (last === content) return {}; // unchanged ⇒ do nothing (stays cached)

    // CHANGED ⇒ append a fresh fabricated pair at the tail (append-only, never remove).
    const callId = `asi-${ctx.turnStartNow.getTime()}-${stepNumber}-${messages.length}`;
    const next = [
      ...messages,
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: callId, toolName: ADDITIONAL_SYSTEM_INFO_TOOL, input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: callId,
            toolName: ADDITIONAL_SYSTEM_INFO_TOOL,
            output: { type: "text", value: content },
          },
        ],
      },
    ] as ModelMessage[];

    // Persist what was emitted (so it replays verbatim next turn).
    ctx.persist?.({
      toolCallId: callId,
      toolName: ADDITIONAL_SYSTEM_INFO_TOOL,
      content,
    });

    ctx.onBlockBuilt?.(stepNumber, content);
    return { messages: next };
  };
}
