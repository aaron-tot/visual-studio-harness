import { describe, expect, test } from "bun:test";
import type { MessagePartType } from "../../../../_shared/types";

type GroupedParts = MessagePartType[] | MessagePartType;

function groupByStep(parts: MessagePartType[]): GroupedParts[] {
  const out: GroupedParts[] = [];
  let buffer: MessagePartType[] = [];
  let currentStep: number | undefined;

  const flush = () => {
    if (buffer.length > 1) out.push(buffer);
    else if (buffer.length === 1) out.push(buffer[0]);
    buffer = [];
    currentStep = undefined;
  };

  for (const p of parts) {
    if (p.type === "tool" && p.stepIndex != null) {
      if (currentStep === undefined) { currentStep = p.stepIndex; buffer.push(p); continue; }
      if (currentStep === p.stepIndex) { buffer.push(p); continue; }
      const flushFn = () => {
        if (buffer.length > 1) out.push(buffer);
        else if (buffer.length === 1) out.push(buffer[0]);
        buffer = [];
        currentStep = undefined;
      };
      flushFn();
      currentStep = p.stepIndex;
      buffer.push(p);
      continue;
    }
    const flushFn = () => {
      if (buffer.length > 1) out.push(buffer);
      else if (buffer.length === 1) out.push(buffer[0]);
      buffer = [];
      currentStep = undefined;
    };
    flushFn();
    out.push(p);
  }
  const flushFn = () => {
    if (buffer.length > 1) out.push(buffer);
    else if (buffer.length === 1) out.push(buffer[0]);
    buffer = [];
    currentStep = undefined;
  };
  flushFn();
  return out;
}

function tool(toolCallId: string, toolName: string, stepIndex?: number) {
  return { type: "tool", toolCallId, toolName, status: "completed", args: {}, stepIndex };
}

function text(content: string) {
  return { type: "text", content };
}

describe("groupByStep", () => {
  test("groups parallel tools sharing a stepIndex into one array", () => {
    const parts = [{ type: "tool", toolCallId: "a", toolName: "read", status: "completed", args: {}, stepIndex: 1 },
      { type: "tool", toolCallId: "b", toolName: "grep", status: "completed", args: {}, stepIndex: 1 },
      { type: "tool", toolCallId: "c", toolName: "glob", status: "completed", args: {}, stepIndex: 1 }];
    const out = groupByStep(parts);
    expect(out).toHaveLength(1);
    expect(Array.isArray(out[0])).toBe(true);
    expect((out[0] as any[]).map((p) => p.toolCallId)).toEqual(["a", "b", "c"]);
  });

  test("single tool is not grouped", () => {
    const parts = [{ type: "tool", toolCallId: "a", toolName: "read", status: "completed", args: {}, stepIndex: 1 }];
    const out = groupByStep(parts);
    expect(Array.isArray(out[0])).toBe(false);
  });

  test("different stepIndex splits into separate groups", () => {
    const parts = [{ type: "tool", toolCallId: "a", toolName: "read", status: "completed", args: {}, stepIndex: 1 },
      { type: "tool", toolCallId: "b", toolName: "read", status: "completed", args: {}, stepIndex: 2 }];
    const out = groupByStep(parts);
    expect(out).toHaveLength(2);
  });

  test("tool without stepIndex passes through ungrouped", () => {
    const parts = [{ type: "tool", toolCallId: "a", toolName: "read", status: "completed", args: {} },
      { type: "tool", toolCallId: "b", toolName: "grep", status: "completed", args: {} }];
    const out = groupByStep(parts);
    expect(out).toHaveLength(2);
    expect(Array.isArray(out[0])).toBe(false);
  });

  test("interleaved text breaks the batch group", () => {
    const parts = [{ type: "tool", toolCallId: "a", toolName: "read", status: "completed", args: {}, stepIndex: 1 },
      { type: "text", content: "hi" },
      { type: "tool", toolCallId: "b", toolName: "grep", status: "completed", args: {}, stepIndex: 1 }];
    const out = groupByStep(parts);
    expect(Array.isArray(out[0])).toBe(false);
  });
});