import { type ModelMessage, type PrepareStepFunction, type ToolSet } from "ai";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";
import { buildAdditionalSystemInfoBlock } from "../system-prompt/builder";
import { ADDITIONAL_SYSTEM_INFO_TAG } from "../system-prompt/constants";

/**
 * Persisted tool-name marker for the trailing `additional_system_info`
 * injection (stored stepPart toolName + UI bubble identity). The injection is
 * NEVER registered in the AI SDK `tools` map and never appears as an assistant
 * tool-call on the wire: `prepareStep` appends it as a single `system`-role
 * text message at the tail (a system-side, prompt-cache tail). A system
 * message is not callable, so the model cannot emit it as a tool call — this
 * removes the NoSuchToolError loop the former fabricated tool-call caused.
 */
export const ADDITIONAL_SYSTEM_INFO_TOOL = "additional_system_info";

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
        const { content } = ctx.pendingInjection;
        ctx.pendingInjection = null;
        // The injection rides as a `system`-role tail message: same position as
        // the old fabricated pair (after the previous step's tool results),
        // same prompt-cache property (tail append), but NOT callable — the
        // model cannot emit a system message as a tool call.
        return {
          messages: [
            ...messages,
            { role: "system", content },
          ] as ModelMessage[],
        };
      }
      return {};
    },

    emitAtStepEnd: async (stepNumber) => {
      if (ctx.noSystemPrompt) return;
      let content = await buildAdditionalSystemInfoBlock({
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
      // `always`: re-inject every step regardless of change (e.g. constant todo
      // reminder) AND even when every enabled section resolves empty — spec:
      // "If changed OR alwaysInject=true → Emit" (no empty-content exception).
      if (!content && ctx.additionalSystemInfoAlways) {
        content = `<${ADDITIONAL_SYSTEM_INFO_TAG}>\n</${ADDITIONAL_SYSTEM_INFO_TAG}>`;
      }
      if (!content) return; // empty resolved block ⇒ skip (emit-on-change mode)

      const baseline = ctx.lastEmitted ?? ctx.systemAsiBaseline ?? null;
      if (!ctx.additionalSystemInfoAlways && baseline != null && baseline === content) return; // unchanged ⇒ do nothing

      const callId = `asi-${ctx.turnStartNow.getTime()}-${stepNumber}`;
      ctx.pendingInjection = { callId, content };
      ctx.lastEmitted = content;
      ctx.onBlockBuilt?.(stepNumber, content);
      ctx.persist?.({ toolCallId: callId, toolName: ADDITIONAL_SYSTEM_INFO_TOOL, content, stepIndex: stepNumber });
    },
  };
}
