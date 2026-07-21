import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAccessiblePath, EXTERNAL_DIRECTORY_PREFIX } from "./path-access";
import { writeGlobal } from "./perms/store";
import type { BaseToolContext } from "./types";

const extKey = (tool: string) => `${EXTERNAL_DIRECTORY_PREFIX}${tool}`;

describe("resolveAccessiblePath", () => {
  let dataDir: string;
  let workspace: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vsh-path-"));
    workspace = join(dataDir, "ws");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(dataDir, "globalPerms.default.json"), JSON.stringify({
      version: 1,
      tools: { [extKey("read")]: "deny", write: "allow" },
    }));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function ctx(overrides: Partial<BaseToolContext> = {}): BaseToolContext {
    return {
      sessionId: "s1",
      turnId: 1,
      workspaceRoot: workspace,
      dataDir,
      abortSignal: new AbortController().signal,
      callId: "c1",
      toolName: "read",
      askPermission: async () => false,
      ...overrides,
    };
  }

  test("inside workspace always ok", async () => {
    const abs = await resolveAccessiblePath(ctx(), "hello.txt");
    expect(abs).toBe(join(workspace, "hello.txt"));
  });

  test("outside denied by default template deny", async () => {
    await writeGlobal(dataDir, { [extKey("read")]: "deny" });
    await expect(resolveAccessiblePath(ctx(), "/tmp/out.txt")).rejects.toThrow(/denied/);
  });

  test("outside allow skips ask", async () => {
    await writeGlobal(dataDir, { [extKey("read")]: "allow" });
    const abs = await resolveAccessiblePath(ctx(), "/tmp/out.txt");
    expect(abs).toBe("/tmp/out.txt");
  });

  test("outside ask uses askPermission", async () => {
    await writeGlobal(dataDir, { [extKey("read")]: "ask" });
    let asked = false;
    const abs = await resolveAccessiblePath(
      ctx({
        askPermission: async (name) => {
          asked = name === extKey("read");
          return true;
        },
      }),
      "/tmp/out2.txt"
    );
    expect(asked).toBe(true);
    expect(abs).toBe("/tmp/out2.txt");
  });

  test("per-tool external keys are independent", async () => {
    await writeGlobal(dataDir, {
      [extKey("read")]: "allow",
      [extKey("write")]: "deny",
    });
    const readAbs = await resolveAccessiblePath(ctx({ toolName: "read" }), "/tmp/a.txt");
    expect(readAbs).toBe("/tmp/a.txt");
    await expect(
      resolveAccessiblePath(ctx({ toolName: "write" }), "/tmp/b.txt")
    ).rejects.toThrow(/denied/);
  });
});
