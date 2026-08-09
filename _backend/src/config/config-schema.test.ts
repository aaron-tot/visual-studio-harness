import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigFile } from "../../../_shared/types";
import { getAgentSettings } from "../features/agents/runtime-settings";
import { loadConfig } from "../storage/config";
import { ConfigFileSchema } from "./schema";

describe("ConfigFileSchema round-trip (spec §6)", () => {
  test("preserves toolExecutionMode, permissionRequestTimeout*, systemPromptBase", () => {
    const out = ConfigFileSchema.parse({
      providers: [],
      toolExecutionMode: "concurrent",
      permissionRequestTimeoutEnabled: true,
      permissionRequestTimeoutMs: 5000,
      systemPromptBase: { mode: "existing", path: "/x/prompt.md" },
    });
    expect(out.toolExecutionMode).toBe("concurrent");
    expect(out.permissionRequestTimeoutEnabled).toBe(true);
    expect(out.permissionRequestTimeoutMs).toBe(5000);
    expect(out.systemPromptBase?.path).toBe("/x/prompt.md");
  });

  test("applies defaults when keys absent", () => {
    const out = ConfigFileSchema.parse({ providers: [] });
    expect(out.toolExecutionMode).toBe("sequential");
    expect(out.permissionRequestTimeoutEnabled).toBe(false);
    expect(out.permissionRequestTimeoutMs).toBe(120000);
    expect(out.systemPromptBase).toBeUndefined();
  });
});

describe("loadConfig drift guard (spec §5)", () => {
  test("drops unknown keys with a warning, preserves known keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vsh-config-drift-"));
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({ providers: [], toolExecutionMode: "sequential", madeUpKey: "should-warn" }),
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = await loadConfig(dir);
      expect(cfg.toolExecutionMode).toBe("sequential");
      expect("madeUpKey" in cfg).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("getAgentSettings systemPromptBase fallback (spec §3)", () => {
  const globalCfg = {
    providers: [],
    systemPromptBase: { mode: "inline" as const, content: "global" },
  } as ConfigFile;

  test("per-agent override wins over config default", () => {
    const merged = getAgentSettings(
      { providerName: "x", modelName: "m", systemPromptBase: { mode: "inline", content: "agent" } },
      globalCfg,
    );
    expect(merged.systemPromptBase?.content).toBe("agent");
  });

  test("config-level systemPromptBase is the fallback", () => {
    const merged = getAgentSettings({ providerName: "x", modelName: "m" }, globalCfg);
    expect(merged.systemPromptBase?.content).toBe("global");
  });
});
