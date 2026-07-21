import { describe, expect, test } from "bun:test";
import {
  resolveRuntimeFromSettings,
  getAgentSettings,
  getCustomAgentSettings,
  getSubagentSettings,
} from "./runtime-settings";
import type { ConfigFile } from "../../../_shared/types";

const base: ConfigFile = {
  providers: [
    {
      displayName: "Local",
      baseUrl: "http://127.0.0.1:8080",
      models: [
        { displayName: "Big", modelName: "big" },
        { displayName: "Small", modelName: "small" },
      ],
    },
  ],
  defaultProvider: "Local",
  defaultModel: "Big",
};

describe("runtime-settings", () => {
  test("getAgentSettings fills defaults", () => {
    const s = getAgentSettings({}, base);
    expect(s.providerName).toBe("Local");
    expect(s.modelName).toBe("Big");
    expect(s.thinking).toEqual({ effort: "off" });
    expect(s.maxSteps).toBe(30);
    expect(s.skillMds).toEqual([]);
  });

  test("getAgentSettings merges settings over defaults", () => {
    const s = getAgentSettings(
      { providerName: "Custom", modelName: "Small", maxSteps: 15 },
      base,
    );
    expect(s.providerName).toBe("Custom");
    expect(s.modelName).toBe("Small");
    expect(s.maxSteps).toBe(15);
  });

  test("getAgentSettings preserves agentMd and skillMds", () => {
    const s = getAgentSettings(
      {
        agentMd: { mode: "existing", path: "/tmp/agent.md" },
        skillMds: [{ mode: "existing", name: "test-skill" }],
      },
      base,
    );
    expect(s.agentMd?.path).toBe("/tmp/agent.md");
    expect(s.skillMds).toHaveLength(1);
  });

  test("getCustomAgentSettings returns undefined for missing key", () => {
    expect(getCustomAgentSettings(base, "nonexistent")).toBeUndefined();
  });

  test("getCustomAgentSettings returns custom agent settings", () => {
    const cfg: ConfigFile = {
      ...base,
      agents: {
        custom: { providerName: "Local", modelName: "Small", temperature: 0.1 },
      },
    };
    const s = getCustomAgentSettings(cfg, "custom");
    expect(s?.modelName).toBe("Small");
    expect(s?.temperature).toBe(0.1);
  });

  test("resolveRuntimeFromSettings resolves provider and model", () => {
    const r = resolveRuntimeFromSettings(
      { providerName: "Local", modelName: "Small" },
      base.providers,
    );
    expect(r.model.displayName).toBe("Small");
    expect(r.maxConcurrent).toBe(1);
  });

  test("resolveRuntimeFromSettings falls back to enabled provider", () => {
    const r = resolveRuntimeFromSettings(
      { providerName: "Nonexistent" },
      base.providers,
    );
    expect(r.provider.displayName).toBe("Local");
  });

  test("resolveRuntimeFromSettings throws when no providers", () => {
    expect(() =>
      resolveRuntimeFromSettings({}, []),
    ).toThrow("Provider not found");
  });

  test("getSubagentSettings returns empty object when not configured", () => {
    expect(getSubagentSettings(base)).toEqual({});
  });

  test("getSubagentSettings returns configured values", () => {
    const cfg: ConfigFile = {
      ...base,
      subagent: { maxConcurrent: 3, slotBusyPolicy: "queue" },
    };
    const s = getSubagentSettings(cfg);
    expect(s.maxConcurrent).toBe(3);
    expect(s.slotBusyPolicy).toBe("queue");
  });
});
