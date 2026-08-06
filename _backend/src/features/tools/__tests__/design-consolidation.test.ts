import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createDefaultRegistry } from "../index";
import { designTool } from "../consolidated/design";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const DESIGN_ACTIONS = ["create", "read", "edit", "abandon"];

// Create a temp directory for each test run
let testDataDir: string;

async function createTestCtx() {
  testDataDir = join("/tmp", `design-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDataDir, { recursive: true });
  return {
    dataDir: testDataDir,
    sessionId: "test-session",
    workspaceRoot: "/tmp",
    abortSignal: null as any,
    callId: "test-call",
    askPermission: async () => true,
    hookCtx: undefined,
  };
}

async function cleanupTestDir() {
  if (testDataDir) {
    await rm(testDataDir, { recursive: true, force: true });
  }
}

describe("design tool consolidation", () => {
  it("registers a single consolidated 'design' tool instead of 4 individual design tools", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);

    expect(names).toContain("design");
    expect(names.filter((n) => n.startsWith("design_"))).toEqual([]);
  });

  it("notes_list is removed (list feature=notes covers it)", () => {
    const registry = createDefaultRegistry();
    const names = registry.list().map((t) => t.name);
    expect(names).not.toContain("notes_list");
  });

  it("exposes all 4 action enum values", () => {
    const schema = designTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect([...values].sort()).toEqual(DESIGN_ACTIONS.sort());
  });

  it("requires action and rejects an unknown action", () => {
    const schema = designTool.inputSchema as any;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ action: "bogus" }).success).toBe(false);
    expect(schema.safeParse({ action: "read", name: "x", type: "spec" }).success).toBe(true);
  });

  it("has all params optional plus required action (flat schema)", () => {
    const schema = designTool.inputSchema as any;
    const shape = schema.shape;
    for (const [key, field] of Object.entries(shape)) {
      if (key === "action") continue;
      const typeName = field._def.typeName;
      expect(
        typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault",
        `param '${key}' should be optional`,
      ).toBe(true);
    }
  });

  it("throw: unknown action produces an error result", async () => {
    const ctx = await createTestCtx();
    const res = await designTool.execute({ action: "bogus" as any }, ctx);
    expect(res.isError).toBe(true);
    await cleanupTestDir();
  });

  it("design tool has permissionDefault 'allow'", () => {
    const registry = createDefaultRegistry();
    const design = registry.list().find((t) => t.name === "design");
    expect(design?.permissionDefault).toBe("allow");
  });

  describe("integration: create spec with content object", () => {
    it("creates a spec with goal, requirements, and parts via content object", async () => {
      const ctx = await createTestCtx();
      const res = await designTool.execute({
        action: "create",
        type: "spec",
        name: "integration-test-spec",
        goal: "Test spec creation",
        content: {
          requirements: [
            { id: "1", description: "Requirement one", priority: "high" },
            { id: "2", description: "Requirement two", priority: "medium" },
          ],
          constraints: ["Constraint A"],
          assumptions: ["Assumption B"],
          acceptanceCriteria: ["Criterion C"],
          parts: [
            { id: "part-1", title: "Phase 1", description: "First phase", parts: [] },
          ],
        },
      }, ctx);

      expect(res.isError).not.toBe(true);
      expect(res.output).toContain("Created spec v1");
      expect(res.output).toContain("integration-test-spec");
      expect(res.metadata?.action).toBe("created");
      expect(res.metadata?.type).toBe("spec");
      expect(res.metadata?.name).toBe("integration-test-spec");
      await cleanupTestDir();
    });

    it("rejects string content (must be object)", async () => {
      const ctx = await createTestCtx();
      // This should fail validation at the schema level
      const schema = designTool.inputSchema as any;
      const result = schema.safeParse({
        action: "create",
        type: "spec",
        name: "bad-content-test",
        content: "this is a string, not an object",
      });
      expect(result.success).toBe(false);
      await cleanupTestDir();
    });
  });

  describe("integration: create plan with content object", () => {
    it("creates a plan with endGoal and parts via content object", async () => {
      const ctx = await createTestCtx();
      const res = await designTool.execute({
        action: "create",
        type: "plan",
        name: "integration-test-plan",
        goal: "Test plan creation",
        specReference: "some-spec",
        content: {
          parts: [
            { id: "step-1", title: "Setup", description: "Initial setup", parts: [] },
            { id: "step-2", title: "Implementation", description: "Core work", parts: [] },
          ],
          tags: ["backend", "api"],
        },
      }, ctx);

      expect(res.isError).not.toBe(true);
      expect(res.output).toContain("Created plan v1");
      expect(res.output).toContain("integration-test-plan");
      expect(res.metadata?.action).toBe("created");
      expect(res.metadata?.type).toBe("plan");
      await cleanupTestDir();
    });
  });

  describe("integration: read spec", () => {
    it("reads a spec that was just created", async () => {
      const ctx = await createTestCtx();
      await designTool.execute({
        action: "create",
        type: "spec",
        name: "read-test",
        goal: "Test reading",
        content: { requirements: [{ id: "1", description: "Req", priority: "high" }] },
      }, ctx);

      const readRes = await designTool.execute({
        action: "read",
        name: "read-test",
        type: "spec",
      }, ctx);

      expect(readRes.isError).not.toBe(true);
      expect(readRes.output).toContain("read-test");
      expect(readRes.metadata?.name).toBe("read-test");
      expect(readRes.metadata?.type).toBe("spec");
      await cleanupTestDir();
    });
  });

  describe("integration: edit spec with patch (RFC 7396)", () => {
    it("patches a spec by adding requirements", async () => {
      const ctx = await createTestCtx();
      await designTool.execute({
        action: "create",
        type: "spec",
        name: "patch-test",
        goal: "Original goal",
        content: { requirements: [{ id: "1", description: "Original", priority: "high" }] },
      }, ctx);

      const editRes = await designTool.execute({
        action: "edit",
        name: "patch-test",
        type: "spec",
        patch: {
          goal: "Updated goal",
          requirements: [
            { id: "1", description: "Original", priority: "high" },
            { id: "2", description: "Added via patch", priority: "medium" },
          ],
        },
      }, ctx);

      expect(editRes.isError).not.toBe(true);
      expect(editRes.output).toContain("Updated");
      expect(editRes.output).toContain("patch mode");
      await cleanupTestDir();
    });
  });

  describe("integration: edit spec with full document replace", () => {
    it("replaces entire spec document", async () => {
      const ctx = await createTestCtx();
      await designTool.execute({
        action: "create",
        type: "spec",
        name: "replace-test",
        goal: "Original",
        content: { requirements: [{ id: "1", description: "Old", priority: "high" }] },
      }, ctx);

      const editRes = await designTool.execute({
        action: "edit",
        name: "replace-test",
        type: "spec",
        document: {
          meta: { id: "replace-test", version: 1 },
          goal: "Completely new goal",
          requirements: [{ id: "1", description: "New req", priority: "high" }],
          constraints: [],
          assumptions: [],
          acceptanceCriteria: [],
          parts: [],
        },
      }, ctx);

      expect(editRes.isError).not.toBe(true);
      expect(editRes.output).toContain("Updated");
      await cleanupTestDir();
    });
  });

  describe("integration: abandon design", () => {
    it("marks a design as abandoned", async () => {
      const ctx = await createTestCtx();
      await designTool.execute({
        action: "create",
        type: "spec",
        name: "abandon-test",
        goal: "Will be abandoned",
      }, ctx);

      const abandonRes = await designTool.execute({
        action: "abandon",
        name: "abandon-test",
        reason: "Superseded by new design",
      }, ctx);

      expect(abandonRes.isError).not.toBe(true);
      expect(abandonRes.output).toContain("abandoned");
      await cleanupTestDir();
    });
  });
});
