import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { designReadTool } from "../builtins/design_read";
import { designEditTool } from "../builtins/design_edit";
import { designsListTool } from "../builtins/designs_list";
import { listTool } from "../builtins/list";
import { auditEditTool } from "../builtins/audit_edit";
import { findAuditScope, editAudit } from "../../../rest/audits";

let dataDir: string;
let workspaceRoot: string;

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    dataDir,
    sessionId: "sess-1",
    workspaceRoot,
    abortSignal: null as any,
    callId: "c1",
    askPermission: async () => true,
    hookCtx: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  const base = join(tmpdir(), `vsh-tool-bugs-${Date.now()}`);
  dataDir = join(base, "data");
  workspaceRoot = join(base, "ws");
  await mkdir(join(dataDir, "designs", "demo"), { recursive: true });
  await mkdir(join(dataDir, "audits"), { recursive: true });
  await mkdir(join(workspaceRoot, ".agentHarness", "designs", "proj-design"), { recursive: true });
  await mkdir(join(workspaceRoot, ".agentHarness", "audits", "proj-audit"), { recursive: true });

  // Spec missing meta entirely (reproduces list crash)
  await writeFile(
    join(dataDir, "designs", "demo", "specV1.json"),
    JSON.stringify({ goal: "no meta" }) + "\n",
  );
  // Normal project-scope design
  await writeFile(
    join(workspaceRoot, ".agentHarness", "designs", "proj-design", "specV1.json"),
    JSON.stringify({ meta: { version: 1, title: "proj" }, goal: "project design" }) + "\n",
  );
  // Project-scope audit
  await writeFile(
    join(workspaceRoot, ".agentHarness", "audits", "proj-audit", "audit.json"),
    JSON.stringify({
      meta: {
        id: "proj-audit",
        title: "Project Audit",
        auditType: "general_audit",
        createdAt: new Date().toISOString(),
        createdBy: "agent",
        scope: "project",
        summary: "sum",
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
      },
      findings: [],
    }) + "\n",
  );
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

describe("design read — existsSync + scope search", () => {
  it("reads without crashing (existsSync imported)", async () => {
    const res = await designReadTool.execute(
      { name: "demo", type: "spec" },
      ctx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.metadata?.found).toBe(true);
    expect(res.output).toContain("no meta");
  });

  it("finds project-scope design when scope omitted", async () => {
    const res = await designReadTool.execute(
      { name: "proj-design", type: "spec" },
      ctx(),
    );
    expect(res.metadata?.found).toBe(true);
    expect(res.metadata?.scope).toBe("project");
  });
});

describe("design edit — version default + helpful errors", () => {
  it("defaults to latest when version omitted", async () => {
    const res = await designEditTool.execute(
      {
        name: "demo",
        type: "spec",
        patch: { goal: "patched" },
      },
      ctx(),
    );
    expect(res.metadata?.updated).toBe(true);
    expect(res.metadata?.version).toBe(1);
    expect(res.output).not.toContain("undefined");
  });

  it("gives helpful error for missing version instead of vundefined", async () => {
    const res = await designEditTool.execute(
      {
        name: "demo",
        type: "spec",
        version: 99,
        patch: { goal: "x" },
      },
      ctx(),
    );
    expect(res.metadata?.updated).toBe(false);
    expect(res.output).toContain("v99");
    expect(res.output).toContain("Latest available");
    expect(res.output).not.toContain("vundefined");
  });
});

describe("list designs — missing meta.version", () => {
  it("designs_list does not crash on missing meta", async () => {
    const res = await designsListTool.execute({ scope: "global" }, ctx());
    expect(res.isError).toBeUndefined();
    expect(res.output).toContain("demo");
  });

  it("list feature=designs does not crash on missing meta", async () => {
    const res = await listTool.execute({ feature: "designs", scope: "global" }, ctx());
    expect(res.isError).toBeUndefined();
    expect(res.output).toContain("demo");
  });
});

describe("audit edit — resolve scope from existing doc", () => {
  it("findAuditScope locates project audit", async () => {
    const sc = await findAuditScope("proj-audit", dataDir, workspaceRoot, "sess-1");
    expect(sc).toBe("project");
  });

  it("edit without scope updates project audit (not global duplicate)", async () => {
    const res = await auditEditTool.execute(
      {
        name: "proj-audit",
        document: {
          meta: {
            id: "proj-audit",
            title: "Project Audit Updated",
            auditType: "general_audit",
            createdAt: new Date().toISOString(),
            createdBy: "agent",
            scope: "project",
            summary: "updated",
            totalFindings: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            infoCount: 0,
          },
          findings: [],
        },
      },
      ctx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.metadata?.updated).toBe(true);
    expect(res.metadata?.scope).toBe("project");
    expect(res.output).toContain("project");

    // Must NOT have created a global copy
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dataDir, "audits", "proj-audit", "audit.json"))).toBe(false);
  });

  it("edit of missing audit errors instead of creating global", async () => {
    await expect(
      editAudit({
        name: "does-not-exist",
        document: {
          meta: {
            id: "x",
            title: "x",
            auditType: "general_audit",
            createdAt: new Date().toISOString(),
            createdBy: "agent",
            scope: "global",
            summary: "x",
            totalFindings: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            infoCount: 0,
          },
          findings: [],
        } as any,
        dataDir,
        // scope omitted
        workspaceRoot,
        sessionId: "sess-1",
      }),
    ).rejects.toThrow(/not found/);
  });
});
