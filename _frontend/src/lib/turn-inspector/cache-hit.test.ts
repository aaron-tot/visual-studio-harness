import { describe, expect, test } from "bun:test";
import type { StepSummary, StepPart, TurnDetail } from "../../../../_shared/types/trace";
import { computeToolGroups } from "./cache-hit";

function step(
  id: number,
  stepIndex: number,
  overrides: Partial<StepSummary> = {},
): StepSummary {
  return {
    id,
    stepIndex,
    status: "completed",
    ...overrides,
  };
}

function tool(stepId: number, seq: number, toolCallId: string, toolName = "read"): StepPart {
  return {
    id: -1,
    stepId,
    type: "tool",
    seq,
    toolCallId,
    toolName,
  };
}

function makeTurn(steps: StepSummary[], stepParts: StepPart[]) {
  return { steps, stepParts } as Pick<TurnDetail, "steps" | "stepParts">;
}

describe("computeToolGroups", () => {
  test("derives cache of tools in step N from the immediately-next step (contiguous)", () => {
    const turn = makeTurn(
      [
        step(10, 0, { inputTokens: 100 }),
        step(11, 1, { inputTokens: 200, cacheReadTokens: 150 }),
      ],
      [tool(10, 0, "call_1"), tool(11, 1, "call_2")],
    );
    const groups = computeToolGroups(turn);
    expect(groups).toHaveLength(2);
    const g0 = groups.find((g) => g.stepId === 10)!;
    expect(g0.cacheHit?.formatted).toBe("150 / 200 (75.0%)"); // from step 1
  });

  test("gaps in stepIndex still resolve to the next real step (non-contiguous)", () => {
    // steps exist at indices 0 and 2 (index 1 missing)
    const turn = makeTurn(
      [
        step(20, 0, { inputTokens: 100 }),
        step(21, 2, { inputTokens: 500, cacheReadTokens: 400 }),
      ],
      [tool(20, 0, "call_1"), tool(21, 2, "call_2")],
    );
    const groups = computeToolGroups(turn);
    const g0 = groups.find((g) => g.stepId === 20)!;
    // Old code looked up stepIndex+1 (==1, missing) -> default 0/0.
    // Fixed code should find the next real step (index 2).
    expect(g0.cacheHit?.formatted).toBe("400 / 500 (80.0%)");
    expect(g0.hasNextStep).toBe(true);
  });

  test("does not silently drop a tool group when its stepId does not resolve", () => {
    // tool references stepId 99 which has no matching step row
    const turn = makeTurn(
      [step(30, 0, { inputTokens: 100, cacheReadTokens: 100 })],
      [tool(30, 0, "call_1"), tool(99, 1, "call_orphan")],
    );
    const groups = computeToolGroups(turn);
    // Both tools should appear across groups (no lossy `continue`)
    const toolIds = groups.flatMap((g) => g.tools.map((t) => t.toolCallId));
    expect(toolIds).toContain("call_1");
    expect(toolIds).toContain("call_orphan");
  });
});
