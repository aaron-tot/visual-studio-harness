import { describe, expect, test } from "bun:test";
import { migrateConfig } from "./migrate";
import type { ConfigFile } from "../../../_shared/types";

describe("migrateConfig", () => {
  test("converts legacy agents to AgentSettings format", () => {
    const legacy: ConfigFile = {
      providers: [],
      agents: {
        testAgent: {
          providerName: "Local",
          modelName: "Big",
          maxSteps: 30,
        },
      },
    } as any;

    const result = migrateConfig(legacy);

    expect(result.agents?.testAgent.providerName).toBe("Local");
    expect(result.agents?.testAgent.modelName).toBe("Big");
    expect(result.agents?.testAgent.maxSteps).toBe(30);
  });

  test("defaults skillMds to empty array", () => {
    const legacy: ConfigFile = {
      providers: [],
      agents: {
        testAgent: { providerName: "Local" },
      },
    } as any;

    const result = migrateConfig(legacy);

    expect(result.agents?.testAgent.skillMds).toEqual([]);
  });

  test("preserves agentMd if present", () => {
    const legacy: ConfigFile = {
      providers: [],
      agents: {
        testAgent: {
          providerName: "Local",
          agentMd: { mode: "existing" as const, path: "/path/to/md" },
        },
      },
    } as any;

    const result = migrateConfig(legacy);

    expect(result.agents?.testAgent.agentMd).toEqual({ mode: "existing", path: "/path/to/md" });
  });

  test("returns empty agents when agents is missing", () => {
    const legacy: ConfigFile = {
      providers: [],
    };

    const result = migrateConfig(legacy);

    expect(result.agents).toEqual({});
  });
});
