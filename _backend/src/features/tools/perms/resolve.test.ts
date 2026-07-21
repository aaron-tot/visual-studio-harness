import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureGlobal,
  writeSession,
  writeWorkspace,
  writeGlobal,
  readGlobal,
  resetGlobal,
  paths,
} from "./store";
import { resolveToolPermission, resolveToolPermissionDetailed } from "./resolve";
import { buildDefaultGlobalFile, setDefaultTools } from "./defaults";
import { createDefaultRegistry } from "../index";

describe("perms store + resolve", () => {
  let dataDir: string;
  let prevTrusted: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vsh-perms-"));
    prevTrusted = process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED;
    delete process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED;
    const registry = createDefaultRegistry();
    setDefaultTools(registry.list());
  });

  afterEach(async () => {
    if (prevTrusted === undefined) delete process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED;
    else process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED = prevTrusted;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("global missing: write from hardcoded defaults, then read the json file", async () => {
    const file = await ensureGlobal(dataDir);
    expect(file.tools.read).toBe("allow");
    expect(file.tools.bash).toBe("ask");

    // Must exist on disk and match what we return
    const raw = JSON.parse(await readFile(paths.global(dataDir), "utf-8"));
    expect(raw.tools.read).toBe("allow");
    expect(raw.tools.bash).toBe("ask");
    expect(raw.tools).toEqual(buildDefaultGlobalFile().tools);

    const again = await readGlobal(dataDir);
    expect(again.exists).toBe(true);
    expect(again.path).toBe(paths.global(dataDir));
  });

  test("session wins and stops (no need for workspace/global keys)", async () => {
    await writeGlobal(dataDir, { bash: "ask", write: "ask", read: "allow" });
    const ws = join(dataDir, "project");
    await mkdir(ws, { recursive: true });
    await writeWorkspace(ws, { bash: "allow" });
    await mkdir(join(dataDir, "sessions", "s1"), { recursive: true });
    await writeSession(dataDir, "s1", { bash: "deny" });

    const r = await resolveToolPermissionDetailed("bash", {
      dataDir,
      sessionId: "s1",
      workspaceRoot: ws,
    });
    expect(r.mode).toBe("deny");
    expect(r.source).toBe("session");
  });

  test("workspace wins when session has no key; else global file", async () => {
    await writeGlobal(dataDir, { bash: "ask", write: "ask", read: "allow" });
    const ws = join(dataDir, "project");
    await mkdir(ws, { recursive: true });
    await writeWorkspace(ws, { bash: "allow" });
    await mkdir(join(dataDir, "sessions", "s1"), { recursive: true });
    await writeSession(dataDir, "s1", {});

    expect(
      await resolveToolPermission("bash", {
        dataDir,
        sessionId: "s1",
        workspaceRoot: ws,
      })
    ).toBe("allow");

    expect(
      await resolveToolPermission("write", {
        dataDir,
        sessionId: "s1",
        workspaceRoot: ws,
      })
    ).toBe("ask");

    expect(
      await resolveToolPermission("read", {
        dataDir,
        sessionId: "s1",
        workspaceRoot: ws,
      })
    ).toBe("allow");
  });

  test("sparse inherit when session/workspace missing", async () => {
    await ensureGlobal(dataDir);
    const mode = await resolveToolPermission("grep", {
      dataDir,
      sessionId: "missing-session",
      workspaceRoot: join(dataDir, "no-ws"),
    });
    expect(mode).toBe("allow");
  });

  test("unknown tool -> ask", async () => {
    await ensureGlobal(dataDir);
    const r = await resolveToolPermissionDetailed("not_a_real_tool", { dataDir });
    expect(r.mode).toBe("ask");
    expect(r.source).toBe("unknown");
  });

  test("trusted env forces allow", async () => {
    process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED = "1";
    await writeGlobal(dataDir, { bash: "deny" });
    expect(await resolveToolPermission("bash", { dataDir })).toBe("allow");
  });

  test("resetGlobal rewrites json from defaults then reads file", async () => {
    await writeGlobal(dataDir, { bash: "deny", read: "deny" });
    const reset = await resetGlobal(dataDir);
    expect(reset.tools.bash).toBe("ask");
    expect(reset.tools.read).toBe("allow");
    const raw = JSON.parse(await readFile(paths.global(dataDir), "utf-8"));
    expect(raw.tools.bash).toBe("ask");
    expect(raw.tools.read).toBe("allow");
  });

  test("edited global file is what resolve uses (not hardcoded defaults)", async () => {
    await ensureGlobal(dataDir);
    await writeGlobal(dataDir, { read: "deny", bash: "allow" });

    const r = await resolveToolPermissionDetailed("read", { dataDir });
    expect(r.mode).toBe("deny");
    expect(r.source).toBe("global");
    // Defaults still say allow — resolve must not use them
    expect(buildDefaultGlobalFile().tools.read).toBe("allow");
  });
});
