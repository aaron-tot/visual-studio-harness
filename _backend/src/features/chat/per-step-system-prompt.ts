import { type ModelMessage, type PrepareStepFunction, type ToolSet } from "ai";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";
import { buildAdditionalSystemInfoBlock } from "../system-prompt/builder";

/** Fabricated tool name for the trailing `additional_system_info` injection. */
export const ADDITIONAL_SYSTEM_INFO_TOOL = "additional_system_info";

/**
 * SYSTEM-ONLY marker. `additional_system_info` is never registered in the AI SDK
 * `tools` map: it is not callable by the agent, and it never appears in the
 * model's tool definitions. It exists only as the fabricated assistant
 * tool-call + tool-result pair emitted by `prepareStep` (a system-side,
 * prompt-cache tail). The SDK accepts an unregistered tool-result natively
 * (passthrough); if a model ever emits such a tool-call anyway, the SDK fails
 * loudly with NoSuchToolError instead of silently executing a no-op.
 */

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
 * The injection is built+compared+emitted at the END of EVERY step (after its
 * tools have run) — per step, on change (spec §6.1). The emit-on-change
 * comparison alone decides whether an injection is emitted; there is no
 * "final step" gating. Each emission reflects the changes the step caused and
 * is attributed to (persisted under) that step. `prepareStep` (start of the
 * next step) only CARRIES the pending injection from the previous step's end
 * into the outgoing request.
 */
export function createPerStepSystemInfo(ctx: PerStepRebuildContext): {
  prepareStep: PrepareStepFunction<ToolSet>;
  emitAtStepEnd: (stepNumber: number) => Promise<void>;
} {
  return {
    prepareStep: async ({ messages }) => {
      if (ctx.pendingInjection) {
        const { callId, content } = ctx.pendingInjection;
        ctx.pendingInjection = null;
        // Include an empty reasoning part so thinking-mode gateways (Console Go)
        // see reasoning_content on this fabricated assistant tool-call. The wire
        // shim in thinking-wire.ts also forces the key if the SDK omits empty text.
        return {
          messages: [
            ...messages,
            {
              role: "assistant",
              content: [
                { type: "reasoning", text: "" },
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
          ] as ModelMessage[],
        };
      }
      return {};
    },

    emitAtStepEnd: async (stepNumber) => {
      if (ctx.noSystemPrompt) return;
      const content = await buildAdditionalSystemInfoBlock({
        dataDir: ctx.dataDir,
        workspaceRoot: ctx.workspaceRoot,
        mode: ctx.mode,
        sessionId: ctx.sessionId,
        noSystemPrompt: ctx.noSystemPrompt,
        agentSettings: ctx.agentSettings as import("../../../../_shared/types").AgentSettings | undefined,
        systemPromptJoiners: ctx.systemPromptJoiners as import("../../../../_shared/types").SystemPromptJoiners | undefined,
        workspaceManifest: ctx.workspaceManifest as import("../../../../_shared/types").WorkspaceManifestSettings | undefined,
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
