import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import {
  ADDITIONAL_SYSTEM_INFO_TOOL,
  createPerStepSystemInfo,
  buildAdditionalSystemInfoTool,
  withAdditionalSystemInfoTool,
  realToolNames,
  type PerStepRebuildContext,
} from "./per-step-system-prompt";

function makeCtx(persisted: unknown[]): PerStepRebuildContext {
  return {
    dataDir: "/tmp/x",
    workspaceRoot: "/tmp/x",
    mode: "dev",
    sessionId: "s",
    noSystemPrompt: false,
    agentSettings: {},
    additionalSystemInfoSections: ["runtime"],
    additionalSystemInfoAlways: true,
    turnStartNow: new Date("2026-08-06T00:00:00Z"),
    persist: (p) => persisted.push(p),
  };
}

describe("additional_system_info no-op tool registration", () => {
  test("withAdditionalSystemInfoTool adds the fabricated tool and it executes as a no-op", async () => {
    const real = {
      read: tool({
        description: "read a file",
        parameters: z.object({}),
        execute: async () => ({ ok: "read" }),
      }),
    };
    const tools = withAdditionalSystemInfoTool(real);

    expect(tools[ADDITIONAL_SYSTEM_INFO_TOOL]).toBeDefined();
    const asi = tools[ADDITIONAL_SYSTEM_INFO_TOOL] as any;
    expect(typeof asi.execute).toBe("function");

    // Executing the no-op must not throw (SDK accepts the fabricated call).
    const result = await asi.execute({}, { toolCallId: "asi-1" } as any);
    expect(result).toBeDefined();
  });

  test("realToolNames lists real tools and excludes additional_system_info", () => {
    const tools = withAdditionalSystemInfoTool({
      read: tool({ description: "r", parameters: z.object({}), execute: async () => ({}) }),
      edit: tool({ description: "e", parameters: z.object({}), execute: async () => ({}) }),
    });

    const names = realToolNames(tools);
    expect(names.includes(ADDITIONAL_SYSTEM_INFO_TOOL)).toBe(false);
    expect(names.sort()).toEqual(["edit", "read"]);
  });
});

describe("additional_system_info per-step emission (spec §6.1)", () => {
  test("emits at the end of EVERY step on change — no final-step gating", async () => {
    const persisted: unknown[] = [];
    const perStep = createPerStepSystemInfo(makeCtx(persisted));

    // always=true ⇒ each step's end emits (bypasses the emit-on-change compare).
    await perStep.emitAtStepEnd(0);
    await perStep.emitAtStepEnd(1);
    await perStep.emitAtStepEnd(2);
    expect(persisted).toHaveLength(3);
    expect((persisted[0] as { stepIndex: number }).stepIndex).toBe(0);
    expect((persisted[1] as { stepIndex: number }).stepIndex).toBe(1);
    expect((persisted[2] as { stepIndex: number }).stepIndex).toBe(2);
  });

  test("emits only on change when always=false (emit-on-change baseline)", async () => {
    const persisted: unknown[] = [];
    // Same-day turnStart so step 0's day-granular datetime matches later steps'.
    const ctx = {
      ...makeCtx(persisted),
      additionalSystemInfoAlways: false,
      turnStartNow: new Date(),
    };
    const perStep = createPerStepSystemInfo(ctx);

    // First step: fresh tail ≠ lastEmitted (null) ⇒ emit.
    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(1);

    // Second step: content unchanged (day-granular datetime, no manifest/todo
    // change) ⇒ equal to lastEmitted ⇒ no new injection.
    await perStep.emitAtStepEnd(1);
    expect(persisted).toHaveLength(1);
  });
});
