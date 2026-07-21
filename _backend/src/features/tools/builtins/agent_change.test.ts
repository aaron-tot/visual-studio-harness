import { describe, expect, test, mock } from "bun:test";
import { agentChangeTool } from "./agent_change";

function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    sessionId: "test-session",
    workspaceRoot: "/tmp/test",
    dataDir: "/tmp/test-data",
    abortSignal: new AbortController().signal,
    callId: "call-1",
    askPermission: async () => true,
    requestAgentChange: async (req: any) => ({
      action: "continue" as const,
    }),
    ...overrides,
  };
}

describe("agentChangeTool", () => {
  test("name is agent_change", () => {
    expect(agentChangeTool.name).toBe("agent_change");
  });

  test("permissionDefault is ask", () => {
    expect(agentChangeTool.permissionDefault).toBe("ask");
  });

  test("inputSchema validates suggestedAgent and reason", () => {
    const schema = agentChangeTool.inputSchema;
    const valid = { suggestedAgent: "sub", reason: "better for this task" };
    const result = schema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("inputSchema rejects missing fields", () => {
    const schema = agentChangeTool.inputSchema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ suggestedAgent: "sub" }).success).toBe(false);
    expect(schema.safeParse({ reason: "x" }).success).toBe(false);
  });
});
