import { describe, expect, test } from "bun:test";
import { groupByStep } from "./group-by-step";
import { toolBatchLabel } from "./tool-batch-label";
import type { MessagePartType } from "../../../../_shared/types";

function tool(toolCallId: string, toolName: string, stepIndex?: number): MessagePartType {
  return { type: "tool", toolCallId, toolName, status: "completed", args: {}, stepIndex } as MessagePartType;
}

function text(content: string): MessagePartType {
  return { type: "text", content } as MessagePartType;
}

describe("groupByStep", () => {
  test("groups parallel tools sharing a stepIndex into one array", () => {
    const parts = [tool("a", "read", 1), tool("b", "grep", 1), tool("c", "glob", 1)];
    const out = groupByStep(parts);
    expect(out).toHaveLength(1);
    expect(Array.isArray(out[0])).toBe(true);
    expect((out[0] as MessagePartType[]).map((p) => p.toolCallId)).toEqual(["a", "b", "c"]);
  });

  test("single tool is not grouped", () => {
    const parts = [tool("a", "read", 1)];
    const out = groupByStep(parts);
    expect(Array.isArray(out[0])).toBe(false);
  });

  test("different stepIndex splits into separate groups", () => {
    const parts = [tool("a", "read", 1), tool("b", "read", 2)];
    const out = groupByStep(parts);
    expect(out).toHaveLength(2);
  });

  test("tool without stepIndex passes through ungrouped", () => {
    const parts = [tool("a", "read"), tool("b", "grep")];
    const out = groupByStep(parts);
    expect(out).toHaveLength(2);
    expect(Array.isArray(out[0])).toBe(false);
  });

  test("interleaved text does NOT break the batch group - groups globally by stepIndex", () => {
    const parts = [tool("a", "read", 1), text("hi"), tool("b", "grep", 1)];
    const out = groupByStep(parts);
    // With global grouping, interleaved text does NOT break the batch
    expect(Array.isArray(out[0])).toBe(true);
    expect((out[0] as MessagePartType[]).map((p) => p.toolCallId)).toEqual(["a", "b"]);
  });
});

describe("toolBatchLabel", () => {
  test("sequential mode → Tool Call Batch: Sequential", () => {
    expect(toolBatchLabel("sequential")).toBe("Tool Call Batch: Sequential");
  });

  test("concurrent mode → Tool Call Batch: Parallel", () => {
    expect(toolBatchLabel("concurrent")).toBe("Tool Call Batch: Parallel");
  });

  test("unset mode defaults to Sequential", () => {
    expect(toolBatchLabel(undefined)).toBe("Tool Call Batch: Sequential");
  });
});
