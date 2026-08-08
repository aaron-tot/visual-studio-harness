import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditTool } from "../consolidated/audit";
import { auditMoveTool } from "../builtins/audit_move";

const roots: string[] = [];

afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

function baseCtx(dataDir: string) {
  return {
    dataDir,
    sessionId: "s1",
    workspaceRoot: "/tmp",
    abortSignal: null,
    callId: "c",
    askPermission: async () => true,
    hookCtx: undefined,
  } as any;
}

describe("audit move action", () => {
  it("exposes 'move' in the action enum", () => {
    const schema = auditTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect(values).toContain("move");
  });

  it("rejects moves that omit fromScope/toScope or target the same scope", () => {
    const schema = auditTool.inputSchema as any;
    expect(schema.safeParse({ action: "move", toScope: "session" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", name: "x", fromScope: "global", toScope: "global" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", name: "x", fromScope: "global", toScope: "session" }).success).toBe(true);
  });

  it("moves an audit via the consolidated tool", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-audit-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "audits", "tool-audit");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "audit.json"), JSON.stringify({ meta: { id: "tool-audit", scope: "global" }, findings: [] }));
    const res = await auditTool.execute(
      { action: "move", name: "tool-audit", fromScope: "global", toScope: "session" },
      baseCtx(dataDir),
    );
    expect(res.isError).toBeFalsy();
    expect(res.output).toContain("tool-audit");
    const moved = join(dataDir, "session", "s1", "audits", "tool-audit", "audit.json");
    expect((await import("node:fs")).existsSync(moved)).toBe(true);
  });

  it("audit_move tool resolves fromScope via findAuditScope when omitted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-audit-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "session", "s1", "audits", "sess-audit");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "audit.json"), JSON.stringify({ meta: { id: "sess-audit", scope: "session" }, findings: [] }));
    const res = await auditMoveTool.execute({ name: "sess-audit", toScope: "global" }, baseCtx(dataDir));
    expect(res.isError).toBeFalsy();
  });
});
