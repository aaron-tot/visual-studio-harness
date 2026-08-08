import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { designTool } from "../consolidated/design";
import { designMoveTool } from "../builtins/design_move";

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

describe("design move action", () => {
  it("exposes 'move' in the action enum", () => {
    const schema = designTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect(values).toContain("move");
  });

  it("rejects moves that omit fromScope/toScope or target the same scope", () => {
    const schema = designTool.inputSchema as any;
    expect(schema.safeParse({ action: "move", toScope: "session" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", name: "x", fromScope: "global", toScope: "global" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", name: "x", fromScope: "global", toScope: "session" }).success).toBe(true);
  });

  it("moves a design via the consolidated tool", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-design-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "designs", "tool-design");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "specV1.json"), JSON.stringify({ meta: { version: 1 } }));
    const res = await designTool.execute(
      { action: "move", name: "tool-design", fromScope: "global", toScope: "session" },
      baseCtx(dataDir),
    );
    expect(res.isError).toBeFalsy();
    expect(existsSync(join(dataDir, "session", "s1", "designs", "tool-design", "specV1.json"))).toBe(true);
  });

  it("design_move tool resolves fromScope via findDesignScope when omitted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-design-tool-"));
    roots.push(dataDir);
    const dir = join(dataDir, "session", "s1", "designs", "sess-design");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "planV1.json"), JSON.stringify({ meta: { version: 1 } }));
    const res = await designMoveTool.execute({ name: "sess-design", toScope: "global" }, baseCtx(dataDir));
    expect(res.isError).toBeFalsy();
  });
});
