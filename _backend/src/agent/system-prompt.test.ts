import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertExactlyOneSystemMessage,
  buildSystemBlock,
  ensureGlobalAgentsFile,
  globalAgentsPath,
  messagesForModel,
  resolveAgentMd,
  resolveSkillMds,
} from "./system-prompt";
import { buildDefaultGlobalAgentsMarkdown } from "./agents.default";
import type { Message } from "../../../_shared/types";

function msg(role: Message["role"], content: string): Message {
  return { role, content, timestamp: "2026-07-12T00:00:00.000Z" };
}

describe("system-prompt assembly", () => {
  let dataDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    const base = join(
      tmpdir(),
      `vsh-sysprompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    dataDir = join(base, "data");
    workspaceRoot = join(base, "workspace");
    await mkdir(dataDir, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  test("ensureGlobalAgentsFile creates from defaults when missing", async () => {
    const path = globalAgentsPath(dataDir);
    await ensureGlobalAgentsFile(dataDir, "dev");
    const onDisk = await readFile(path, "utf-8");
    expect(onDisk).toBe(buildDefaultGlobalAgentsMarkdown());
  });

  test("ensureGlobalAgentsFile does not overwrite existing file", async () => {
    const path = globalAgentsPath(dataDir);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "# Custom global\n\n- user rule\n");
    await ensureGlobalAgentsFile(dataDir, "dev");
    const onDisk = await readFile(path, "utf-8");
    expect(onDisk).toContain("user rule");
    expect(onDisk).not.toBe(buildDefaultGlobalAgentsMarkdown());
  });

  test("buildSystemBlock uses disk global after create, not defaults string directly", async () => {
    const fixed = new Date("2026-07-12T21:00:00.000Z");
    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      sessionId: "sess-1",
      now: fixed,
    });

    const diskGlobal = await readFile(globalAgentsPath(dataDir), "utf-8");
    expect(block).toContain(diskGlobal.trim());
    expect(block).toContain("## Runtime");
    expect(block).toContain(`- workspace_root: ${workspaceRoot}`);
    expect(block).toContain("- mode: dev");
    expect(block).toContain(`- data_dir: ${dataDir}`);
    expect(block).toContain("- session_id: sess-1");
    expect(block).toContain("- datetime: 2026-07-12T21:00:00.000Z");
    const runtimeIdx = block.indexOf("## Runtime");
    const datetimeIdx = block.indexOf("- datetime:");
    expect(datetimeIdx).toBeGreaterThan(runtimeIdx);
  });

  test("edited global file is used; defaults are not re-injected", async () => {
    await ensureGlobalAgentsFile(dataDir, "dev");
    await writeFile(globalAgentsPath(dataDir), "# Edited global\n\n- never force-push\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("never force-push");
    expect(block).not.toContain("surgical precision");
  });

  test("includes project agents.md at workspace root when present", async () => {
    await writeFile(join(workspaceRoot, "agents.md"), "# Project\n\n- use bun\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("use bun");
    const globalIdx = block.indexOf("surgical precision");
    const projectIdx = block.indexOf("use bun");
    const runtimeIdx = block.indexOf("## Runtime");
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeGreaterThan(globalIdx);
    expect(runtimeIdx).toBeGreaterThan(projectIdx);
  });

  test("accepts AGENTS.md (uppercase) as project file", async () => {
    await writeFile(join(workspaceRoot, "AGENTS.md"), "# UPPER only\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("UPPER only");
  });

  test("prefers agents.md over AGENTS.md when both exist", async () => {
    await writeFile(join(workspaceRoot, "agents.md"), "# lowercase\n");
    await writeFile(join(workspaceRoot, "AGENTS.md"), "# UPPERCASE\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("lowercase");
    expect(block).not.toContain("UPPERCASE");
  });

  test("does not recurse into subdirs for agents.md", async () => {
    await mkdir(join(dataDir, "nested"), { recursive: true });
    await mkdir(join(workspaceRoot, "src"), { recursive: true });
    await writeFile(join(dataDir, "nested", "agents.md"), "# nested global\n");
    await writeFile(join(workspaceRoot, "src", "agents.md"), "# nested project\n");
    await writeFile(join(workspaceRoot, "agents.md"), "# root project\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("root project");
    expect(block).not.toContain("nested global");
    expect(block).not.toContain("nested project");
  });

  test("appends global root agents.md then project root agents.md", async () => {
    await mkdir(join(globalAgentsPath(dataDir), ".."), { recursive: true });
    await writeFile(globalAgentsPath(dataDir), "# GLOBAL_ROOT\n");
    await writeFile(join(workspaceRoot, "agents.md"), "# PROJECT_ROOT\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    const g = block.indexOf("GLOBAL_ROOT");
    const p = block.indexOf("PROJECT_ROOT");
    const r = block.indexOf("## Runtime");
    expect(g).toBeGreaterThanOrEqual(0);
    expect(p).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(p);
  });

  test("missing project agents.md does not fail; runtime always present", async () => {
    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain("## Runtime");
    expect(block.length).toBeGreaterThan(0);
  });

  test("does not cap large agents files", async () => {
    const huge = "x".repeat(100_000);
    await mkdir(join(globalAgentsPath(dataDir), ".."), { recursive: true });
    await writeFile(globalAgentsPath(dataDir), huge);

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
    });

    expect(block).toContain(huge);
    expect(block).not.toContain("truncated");
  });

  test("extras append after standing layers", async () => {
    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
      extras: ["You are a subagent."],
    });
    const runtimeIdx = block.indexOf("## Runtime");
    const extraIdx = block.indexOf("You are a subagent.");
    expect(extraIdx).toBeGreaterThan(runtimeIdx);
  });

  test("messagesForModel strips all prior system rows and keeps one", () => {
    const session: Message[] = [
      msg("system", "OLD SYSTEM A"),
      msg("user", "do work"),
      msg("system", "OLD SYSTEM B"),
      msg("assistant", "ok"),
    ];
    const out = messagesForModel(session, "NEW SYSTEM\n\n## Runtime\n- mode: dev");

    expect(out.filter((m) => m.role === "system")).toHaveLength(1);
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toBe("NEW SYSTEM\n\n## Runtime\n- mode: dev");
    expect(out[0]?.content).not.toContain("OLD SYSTEM");
    expect(out.slice(1)).toEqual([
      msg("user", "do work"),
      msg("assistant", "ok"),
    ]);
  });

  test("messagesForModel works with no prior system rows", () => {
    const out = messagesForModel([msg("user", "hi")], "block only");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "system", content: "block only" });
    expect(out[1]).toMatchObject({ role: "user", content: "hi" });
  });

  test("assertExactlyOneSystemMessage accepts single leading system", () => {
    expect(() =>
      assertExactlyOneSystemMessage([
        msg("system", "rules"),
        msg("user", "hi"),
      ])
    ).not.toThrow();
  });

  test("assertExactlyOneSystemMessage allows zero but throws on multiple or misplaced", () => {
    // Zero system messages is allowed (default/no-prompt mode)
    expect(() => assertExactlyOneSystemMessage([msg("user", "hi")])).not.toThrow();
    expect(() =>
      assertExactlyOneSystemMessage([
        msg("system", "a"),
        msg("system", "b"),
        msg("user", "hi"),
      ])
    ).toThrow(/exactly once/);
    expect(() =>
      assertExactlyOneSystemMessage([msg("user", "hi"), msg("system", "late")])
    ).toThrow(/first message/);
  });

  describe("resolveAgentMd", () => {
  test("returns null when agentMd is undefined", async () => {
    expect(await resolveAgentMd(undefined, "", "")).toBeNull();
  });

  test("returns trimmed inline content", async () => {
    const result = await resolveAgentMd(
      { mode: "inline", content: "  Hello Agent  " },
      "",
      ""
    );
    expect(result).toBe("Hello Agent");
  });

  test("returns null for inline content that is whitespace only", async () => {
    const result = await resolveAgentMd(
      { mode: "inline", content: "   " },
      "",
      ""
    );
    expect(result).toBeNull();
  });

  test("reads from file in existing mode", async () => {
    const file = join(dataDir, "custom-agent.md");
    await writeFile(file, "# Agent Instructions\n\n- rule1\n");
    const result = await resolveAgentMd(
      { mode: "existing", path: file },
      dataDir,
      workspaceRoot
    );
    expect(result).toBe("# Agent Instructions\n\n- rule1");
  });

  test("returns null when existing mode file is missing", async () => {
    const result = await resolveAgentMd(
      { mode: "existing", path: "/nonexistent/file.md" },
      "",
      ""
    );
    expect(result).toBeNull();
  });

  test("returns null when existing mode has no path", async () => {
    const result = await resolveAgentMd(
      { mode: "existing" } as any,
      "",
      ""
    );
    expect(result).toBeNull();
  });
});

describe("resolveSkillMds", () => {
  test("returns empty array when undefined", async () => {
    expect(await resolveSkillMds(undefined)).toEqual([]);
  });

  test("returns empty array when empty", async () => {
    expect(await resolveSkillMds([])).toEqual([]);
  });

  test("reads custom mode skill from file", async () => {
    const file = join(dataDir, "skill.md");
    await writeFile(file, "# My Skill\n\nSome content.\n");
    const result = await resolveSkillMds([
      { mode: "custom", path: file },
    ]);
    expect(result).toEqual(["# My Skill\n\nSome content."]);
  });

  test("returns empty for existing mode skill (not yet resolved)", async () => {
    const result = await resolveSkillMds([
      { mode: "existing", name: "frontend-design" },
    ]);
    expect(result).toEqual([]);
  });

  test("reads multiple custom skills", async () => {
    const f1 = join(dataDir, "skill1.md");
    const f2 = join(dataDir, "skill2.md");
    await writeFile(f1, "## Skill A\n");
    await writeFile(f2, "## Skill B\n");
    const result = await resolveSkillMds([
      { mode: "custom", path: f1 },
      { mode: "custom", path: f2 },
    ]);
    expect(result).toEqual(["## Skill A", "## Skill B"]);
  });

  test("skips unreadable custom skill while reading others", async () => {
    const f1 = join(dataDir, "skill1.md");
    const f2 = "/nonexistent/skill.md";
    await writeFile(f1, "## Skill A\n");
    const result = await resolveSkillMds([
      { mode: "custom", path: f1 },
      { mode: "custom", path: f2 },
    ]);
    expect(result).toEqual(["## Skill A"]);
  });
});

describe("buildSystemBlock with agentSettings", () => {
  test("appends inline agent MD after global before project", async () => {
    await mkdir(join(globalAgentsPath(dataDir), ".."), { recursive: true });
    await writeFile(globalAgentsPath(dataDir), "# GLOBAL\n");
    await writeFile(join(workspaceRoot, "agents.md"), "# PROJECT\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
      agentSettings: {
        agentMd: { mode: "inline", content: "# CUSTOM AGENT\n" },
      },
    });

    const globalIdx = block.indexOf("GLOBAL");
    const agentMdIdx = block.indexOf("CUSTOM AGENT");
    const projectIdx = block.indexOf("PROJECT");
    const runtimeIdx = block.indexOf("## Runtime");
    expect(globalIdx).toBeGreaterThanOrEqual(0);
    expect(agentMdIdx).toBeGreaterThan(globalIdx);
    expect(projectIdx).toBeGreaterThan(agentMdIdx);
    expect(runtimeIdx).toBeGreaterThan(projectIdx);
  });

  test("appends resolved skill MDs after agent MD", async () => {
    const skillFile = join(dataDir, "my-skill.md");
    await writeFile(skillFile, "# My Skill\n\nContent.\n");
    await mkdir(join(globalAgentsPath(dataDir), ".."), { recursive: true });
    await writeFile(globalAgentsPath(dataDir), "# GLOBAL\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
      agentSettings: {
        agentMd: { mode: "inline", content: "# AGENT\n" },
        skillMds: [{ mode: "custom", path: skillFile }],
      },
    });

    const agentIdx = block.indexOf("AGENT");
    const skillIdx = block.indexOf("My Skill");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(skillIdx).toBeGreaterThan(agentIdx);
  });

  test("omits agent MD when agentMd is null", async () => {
    await mkdir(join(globalAgentsPath(dataDir), ".."), { recursive: true });
    await writeFile(globalAgentsPath(dataDir), "# GLOBAL\n");

    const block = await buildSystemBlock({
      dataDir,
      workspaceRoot,
      mode: "dev",
      now: new Date("2026-07-12T21:00:00.000Z"),
      agentSettings: {},
    });

    expect(block).toContain("GLOBAL");
    expect(block).toContain("## Runtime");
  });
});
});
