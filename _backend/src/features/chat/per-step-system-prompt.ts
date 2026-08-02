import type { PrepareStepFunction, ToolSet } from "ai";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";
import { buildSystemBlockSections } from "../system-prompt/builder";

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
  /** Timestamp used for the very first step so it matches the turn-initial block. */
  turnStartNow: Date;
  /** Called after each successful rebuild so callers can snapshot the block per step. */
  onBlockBuilt?: (stepNumber: number, block: string) => void;
}

/**
 * Builds a `prepareStep` hook for the AI SDK that rebuilds the COMPLETE system
 * block before every sub-step. Dynamic sections (runtime info, todo list,
 * workspace manifest) are re-evaluated so later steps see current state.
 * The first step reuses the turn-initial timestamp so its block matches the
 * turn-level snapshot; later steps use a fresh timestamp.
 */
export function createPerStepPrepareStep(ctx: PerStepRebuildContext): PrepareStepFunction<ToolSet> {
  return async ({ stepNumber }) => {
    if (ctx.noSystemPrompt) return {};
    const block = await buildSystemBlockSections({
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
    });
    if (!block) return {};
    ctx.onBlockBuilt?.(stepNumber, block);
    return { instructions: block };
  };
}
