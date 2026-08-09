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

describe("additional_system_info once-per-batch emission", () => {
  test("skips non-final steps and emits exactly once on the final step", async () => {
    const persisted: unknown[] = [];
    const perStep = createPerStepSystemInfo(makeCtx(persisted));

    // Two intermediate (non-final) tool steps of the same batch must not emit.
    await perStep.emitAtStepEnd(0, false);
    await perStep.emitAtStepEnd(1, false);
    expect(persisted).toHaveLength(0);

    // The final step emits the single injection.
    await perStep.emitAtStepEnd(2, true);
    expect(persisted).toHaveLength(1);
  });

  test("still emits when isFinalStep defaults to true (backward compat)", async () => {
    const persisted: unknown[] = [];
    const perStep = createPerStepSystemInfo(makeCtx(persisted));

    await perStep.emitAtStepEnd(0);
    expect(persisted).toHaveLength(1);
  });
});
