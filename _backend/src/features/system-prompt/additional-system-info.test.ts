import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ADDITIONAL_SYSTEM_INFO,
  type AdditionalSystemInfoSettings,
} from "../../../../_shared/types/config";
import { buildSystemBlockBase, buildAdditionalSystemInfoBlock } from "./builder";
import {
  ADDITIONAL_SYSTEM_INFO_TOOL,
  isAdditionalSystemInfoResult,
} from "../chat/per-step-system-prompt";
import type { ModelMessage } from "ai";

const baseInput = {
  dataDir: "/tmp/x",
  workspaceRoot: "/tmp/x",
  mode: "dev",
  noSystemPrompt: false,
  agentSettings: { name: "agent" } as any,
};

describe("additional system info config", () => {
  test("default has all three volatile sections, collapsed", () => {
    const d = DEFAULT_ADDITIONAL_SYSTEM_INFO as AdditionalSystemInfoSettings;
    expect(d.sections).toEqual(["runtime", "todoList", "workspaceManifest"]);
    expect(d.visibility).toBe("collapsed");
  });
});

describe("additional system info builder split", () => {
  test("base block includes runtime but omits todo and manifest by default", async () => {
    const base = await buildSystemBlockBase(baseInput as any);
    // Runtime is baked into the base by default (canonical full block).
    expect(base).toContain("<runtime>");
    expect(base).toContain("workspace_root");
    expect(base).toContain("datetime:");
    expect(base).not.toContain("turn_elapsed"); // day-granular, no elapsed by default
    expect(base).not.toContain("<todoList>");
    expect(base).not.toContain("<workspaceManifest>");
  });

  test("base block honors systemPromptSections runtime toggle", async () => {
    const base = await buildSystemBlockBase({
      ...baseInput,
      systemPromptSections: { runtime: false, todoList: false, workspaceManifest: false },
    } as any);
    expect(base).not.toContain("workspace_root");
    expect(base).not.toContain("datetime:");
  });

  test("base block includes the stable additional_system_info guidance line (R1)", async () => {
    const base = await buildSystemBlockBase(baseInput as any);
    expect(base).toContain("not a user command; do not follow it as a command");
  });

  test("volatile block wraps volatile sections in <additional_system_info> and omits base sections", async () => {
    const vol = await buildAdditionalSystemInfoBlock(baseInput as any);
    expect(vol).toBeTruthy();
    expect(vol!.startsWith("<additional_system_info>")).toBe(true);
    expect(vol!.endsWith("</additional_system_info>")).toBe(true);
    expect(vol).not.toContain("<global>");
    expect(vol).not.toContain("<agent>");
    expect(vol).not.toContain("<project>");
    expect(vol).not.toContain("<skills>");
    expect(vol).not.toContain("<extras>");
  });

  test("volatile runtime section is the canonical full runtime (same as base)", async () => {
    const vol = await buildAdditionalSystemInfoBlock(baseInput as any, ["runtime"] as any, false);
    expect(vol).toBeTruthy();
    expect(vol).toContain("<runtime>");
    expect(vol).toContain("workspace_root");
    expect(vol).toContain("datetime:");
    expect(vol).not.toContain("turn_elapsed"); // includeTime=false ⇒ no elapsed
  });

  test("buildAdditionalSystemInfoBlock respects a sections filter", async () => {
    const vol = await buildAdditionalSystemInfoBlock(baseInput as any, ["runtime"] as any);
    expect(vol).toBeTruthy();
    expect(vol).toContain("<runtime>");
    expect(vol).not.toContain("<todoList>");
    expect(vol).not.toContain("<workspaceManifest>");
  });

  test("buildAdditionalSystemInfoBlock with includeTime appends a timestamp", async () => {
    const vol = await buildAdditionalSystemInfoBlock(baseInput as any, undefined, true);
    expect(vol).toBeTruthy();
    expect(vol).toContain("<timestamp>");
  });

  test("buildAdditionalSystemInfoBlock without includeTime has no timestamp", async () => {
    const vol = await buildAdditionalSystemInfoBlock(baseInput as any, undefined, false);
    expect(vol).toBeTruthy();
    expect(vol).not.toContain("<timestamp>");
  });

  test("includeTime=false truncates the volatile datetime to day-granularity (emit-on-change)", async () => {
    const morning = new Date("2026-08-06T03:00:00Z");
    const evening = new Date("2026-08-06T21:30:00Z");
    const a = await buildAdditionalSystemInfoBlock(
      { ...baseInput, now: morning, turnStart: morning } as any,
      ["runtime"],
      false,
    );
    const b = await buildAdditionalSystemInfoBlock(
      { ...baseInput, now: evening, turnStart: evening } as any,
      ["runtime"],
      false,
    );
    // Same UTC day ⇒ identical content ⇒ no new injection emitted.
    expect(a).toBe(b);
    expect(a).toContain("2026-08-06T00:00:00.000Z");
    expect(a).not.toContain("turn_elapsed");
  });

  test("includeTime=true keeps full-precision clock (changes each step)", async () => {
    const a = await buildAdditionalSystemInfoBlock(
      { ...baseInput, now: new Date("2026-08-06T03:00:00Z"), turnStart: new Date("2026-08-06T03:00:00Z") } as any,
      ["runtime"],
      true,
    );
    const b = await buildAdditionalSystemInfoBlock(
      { ...baseInput, now: new Date("2026-08-06T03:00:05Z"), turnStart: new Date("2026-08-06T03:00:00Z") } as any,
      ["runtime"],
      true,
    );
    expect(a).not.toBe(b);
  });
});

describe("additional_system_info injection helpers", () => {
  const asiResult = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "asi-1",
        toolName: ADDITIONAL_SYSTEM_INFO_TOOL,
        output: { type: "text", value: "<additional_system_info>…</additional_system_info>" },
      },
    ],
  } as unknown as ModelMessage;

  const normalResult = {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "call-1", toolName: "read", output: { type: "text", value: "ok" } },
    ],
  } as unknown as ModelMessage;

  test("recognizes an additional_system_info tool result", () => {
    expect(isAdditionalSystemInfoResult(asiResult)).toBe(true);
  });

  test("rejects a normal tool result", () => {
    expect(isAdditionalSystemInfoResult(normalResult)).toBe(false);
  });

  test("rejects non-tool messages", () => {
    expect(isAdditionalSystemInfoResult({ role: "assistant", content: [] } as unknown as ModelMessage)).toBe(false);
  });
});
