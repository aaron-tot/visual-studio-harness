import { describe, expect, test } from "bun:test";
import { StepToolBatch } from "./step-tool-batch";
import type {
  StepToolCall,
  StepToolBatchBeforePayload,
  StepToolBatchAfterPayload,
} from "../../../../_shared/types/step-batch";

describe("StepToolBatch", () => {
  test("single tool: before then after fire, order preserved, results populated", async () => {
    const before: StepToolBatchBeforePayload[] = [];
    const after: StepToolBatchAfterPayload[] = [];
    const b = new StepToolBatch({
      onBefore: (p) => { before.push(p); },
      onAfter: (p) => { after.push(p); },
    });
    b.start(0);
    b.addCall({ toolCallId: "c1", toolName: "read", args: { path: "/x" } });
    await b.fireBefore();
    b.addResult("c1", "ok");
    await b.fireAfter();

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    const bf = before[0];
    expect(bf.stepIndex).toBe(0);
    expect(bf.toolCalls.map((t) => t.toolCallId)).toEqual(["c1"]);
    const af = after[0];
    expect(af.toolCalls[0].result).toBe("ok");
    expect(af.toolCalls[0].isError).toBe(false);
  });

  test("fires exactly once even when fireBefore/fireAfter called multiple times", async () => {
    let beforeCalls = 0;
    let afterCalls = 0;
    const b = new StepToolBatch({
      onBefore: async () => { beforeCalls++; },
      onAfter: async () => { afterCalls++; },
    });
    b.start(0);
    b.addCall({ toolCallId: "c1", toolName: "read", args: {} });
    b.addResult("c1", "x");
    await b.fireBefore(); await b.fireBefore();
    await b.fireAfter(); await b.fireAfter();
    expect(beforeCalls).toBe(1);
    expect(afterCalls).toBe(1);
  });

  test("multi-tool order preserved; each result matched by id", async () => {
    const after: StepToolBatchAfterPayload[] = [];
    const b = new StepToolBatch({ onAfter: (p) => { after.push(p); } });
    b.start(1);
    b.addCall({ toolCallId: "a", toolName: "grep", args: { q: "1" } });
    b.addCall({ toolCallId: "b", toolName: "glob", args: {} });
    b.addCall({ toolCallId: "c", toolName: "read", args: { path: "/z" } });
    b.addResult("b", "glob-out");
    b.addResult("a", "grep-out", true);
    b.addResult("c", "read-out");
    await b.fireBefore();
    await b.fireAfter();
    const calls = after[0].toolCalls;
    expect(calls.map((t) => t.toolCallId)).toEqual(["a", "b", "c"]);
    expect(calls[0].result).toBe("grep-out");
    expect(calls[0].isError).toBe(true);
    expect(calls[1].result).toBe("glob-out");
    expect(calls[2].result).toBe("read-out");
  });

  test("empty batch never fires", async () => {
    let beforeCalls = 0;
    let afterCalls = 0;
    const b = new StepToolBatch({
      onBefore: async () => { beforeCalls++; },
      onAfter: async () => { afterCalls++; },
    });
    b.start(0);
    await b.fireBefore(); await b.fireAfter();
    expect(beforeCalls).toBe(0);
    expect(afterCalls).toBe(0);
  });

  test("fireAfter without results still fires with calls-only entries", async () => {
    let afterCalls = 0;
    const b = new StepToolBatch({ onAfter: async () => { afterCalls++; } });
    b.start(0);
    b.addCall({ toolCallId: "c1", toolName: "read", args: {} });
    await b.fireAfter();
    expect(afterCalls).toBe(1);
  });
});
