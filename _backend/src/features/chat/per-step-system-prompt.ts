import { tool, type ModelMessage, type PrepareStepFunction, type ToolSet } from "ai";
import { z } from "zod";
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

/**
 * Build the no-op `additional_system_info` tool. It is registered in the AI SDK
 * `tools` map so the SDK accepts the fabricated tool-call emitted by `prepareStep`
 * instead of throwing `NoSuchToolError`. It performs no work (it is never meant to
 * be run for real value); it exists purely so the SDK can resolve parse the call.
 */
export function buildAdditionalSystemInfoTool() {
  return tool({
    description: "Internal context marker; not a real tool. Ignore and never invoke.",
    parameters: z.object({}),
    execute: async () => ({}),
  });
}

/**
 * Returns a tools map that always includes the registered no-op
 * `additional_system_info` tool alongside the real tools.
 */
export function withAdditionalSystemInfoTool<TOOLS extends ToolSet>(tools: TOOLS): ToolSet {
  return { ...tools, [ADDITIONAL_SYSTEM_INFO_TOOL]: buildAdditionalSystemInfoTool() };
}

/**
 * The real tool names (everything except the fabricated `additional_system_info`).
 * Used as `activeTools` so the no-op stays out of the model's request while still
 * being registered for SDK tool-call parsing.
 */
export function realToolNames(tools: ToolSet): string[] {
  return Object.keys(tools).filter((n) => n !== ADDITIONAL_SYSTEM_INFO_TOOL);
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
  /** When true, ALWAYS emit an injection at the end of the batch regardless of
   *  whether the content changed (bypasses the emit-on-change comparison). The
   *  enabled `sections` still apply. */
  additionalSystemInfoAlways?: boolean;
  /** Timestamp used for the very first step so it matches the turn-initial block. */
  turnStartNow: Date;
  /**
   * Canonical wrapped additional_system_info block for the sections baked into
   * the base system prompt (systemPromptSections). The emit-on-change baseline
   * at the start of the turn: if the fresh content equals what the system already
   * carries, no injection is emitted.
   */
  systemAsiBaseline?: string | null;
  /** Called after each emission so callers can snapshot base(+injection) per step. */
  onBlockBuilt?: (stepNumber: number, block: string) => void;
  /** Persist an emitted injection against the step that JUST ended. */
  persist?: (injection: { toolCallId: string; toolName: string; content: string; stepIndex: number }) => void;

  // internal state shared between prepareStep and emitAtStepEnd
  pendingInjection?: { callId: string; content: string } | null;
  lastEmitted?: string | null;
}

/**
* The injection is built+compared+emitted at the END of the batch's final step
  * (after its tools have run) — once per batch, not per intermediate step — so it
  * reflects the changes that step caused and is attributed to that step.
  * `prepareStep` (start of the next step) only CARRIES the pending injection from
  * the previous step's end into the outgoing request.
  */
export function createPerStepSystemInfo(ctx: PerStepRebuildContext): {
  prepareStep: PrepareStepFunction<ToolSet>;
  emitAtStepEnd: (stepNumber: number, isFinalStep?: boolean) => Promise<void>;
} {
  return {
    prepareStep: async ({ messages }) => {
      if (ctx.pendingInjection) {
        const { callId, content } = ctx.pendingInjection;
        ctx.pendingInjection = null;
        return {
          messages: [
            ...messages,
            {
              role: "assistant",
              content: [{ type: "tool-call", toolCallId: callId, toolName: ADDITIONAL_SYSTEM_INFO_TOOL, input: {} }],
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
          ] as ModelMessage[],
        };
      }
      return {};
    },

    emitAtStepEnd: async (stepNumber, isFinalStep = true) => {
      if (ctx.noSystemPrompt) return;
      // Emit only once per batch of tool steps, at the batch's final step —
      // intermediate steps (more tool calls to follow) must not inject.
      if (isFinalStep === false) return;
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
      if (!content) return; // empty resolved block ⇒ skip

      const baseline = ctx.lastEmitted ?? ctx.systemAsiBaseline ?? null;
      // `always`: re-inject every step regardless of change (e.g. constant todo reminder).
      if (!ctx.additionalSystemInfoAlways && baseline != null && baseline === content) return; // unchanged ⇒ do nothing

      const callId = `asi-${ctx.turnStartNow.getTime()}-${stepNumber}`;
      ctx.pendingInjection = { callId, content };
      ctx.lastEmitted = content;
      ctx.onBlockBuilt?.(stepNumber, content);
      ctx.persist?.({ toolCallId: callId, toolName: ADDITIONAL_SYSTEM_INFO_TOOL, content, stepIndex: stepNumber });
    },
  };
}
