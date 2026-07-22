import { describe, expect, test } from "bun:test";
import { splitSystemInstructions } from "./prompt-messages";
import type { Message } from "../../../_shared/types";
import { buildWorkspaceManifestContext, buildSystemPromptWithManifest } from "../core/workspaceGraph/prompt/manifest-context";
import type { WorkspaceGraphService } from "../core/workspaceGraph/api/types";

function msg(
  role: Message["role"],
  content: string
): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

describe("splitSystemInstructions", () => {
  test("lifts system messages into instructions", () => {
    const out = splitSystemInstructions([
      msg("system", "You are a subagent."),
      msg("user", "Create a file"),
    ]);
    expect(out.instructions).toBe("You are a subagent.");
    expect(out.messages).toEqual([{ role: "user", content: "Create a file" }]);
  });

  test("joins multiple system messages", () => {
    const out = splitSystemInstructions([
      msg("system", "Global rules"),
      msg("system", "Subagent rules"),
      msg("user", "hi"),
      msg("assistant", "hello"),
    ]);
    expect(out.instructions).toBe("Global rules\n\nSubagent rules");
    expect(out.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  test("returns undefined instructions when no system messages", () => {
    const out = splitSystemInstructions([
      msg("user", "hi"),
      msg("assistant", "hello"),
    ]);
    expect(out.instructions).toBeUndefined();
    expect(out.messages).toHaveLength(2);
  });

  test("skips empty system content", () => {
    const out = splitSystemInstructions([
      msg("system", "   "),
      msg("user", "hi"),
    ]);
    expect(out.instructions).toBeUndefined();
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});

function mockGraph(manifestTree: string): WorkspaceGraphService {
  return {
    async start() {},
    async stop() {},
    async reindexAll() {},
    query: {
      async findSymbol() { return []; },
      async findFunction() { return []; },
      async findClass() { return []; },
      async findInterface() { return []; },
      async listImports() { return []; },
      async listExports() { return []; },
      async listFiles() { return []; },
      async listFolders() { return []; },
      async workspaceSummary() { return { fileCount: 0, folderCount: 0, symbolCount: 0, languages: [], lastIndexedAt: 0 }; },
    },
    manifest: {
      async workspaceManifest() { return manifestTree; },
      async workspaceManifestFiles() { return manifestTree; },
      async workspaceManifestFolders() { return ""; },
      async workspaceSummary() { return "Files: 10\nSymbols: 42"; },
    },
  };
}

describe("buildWorkspaceManifestContext", () => {
  test("returns null when manifest is disabled", async () => {
    const result = await buildWorkspaceManifestContext({
      config: { enabled: false },
      graph: mockGraph("src/\n  index.ts"),
    });
    expect(result).toBeNull();
  });

  test("returns null when agent is not in allowed list", async () => {
    const result = await buildWorkspaceManifestContext({
      config: { enabled: true, agents: ["agent-a", "agent-b"] },
      graph: mockGraph("src/\n  index.ts"),
      agentId: "agent-c",
    });
    expect(result).toBeNull();
  });

  test("returns manifest when enabled", async () => {
    const result = await buildWorkspaceManifestContext({
      config: { enabled: true, maxDepth: 2 },
      graph: mockGraph("└── .\n    └── src\n        └── index.ts"),
    });
    expect(result).not.toBeNull();
    expect(result).toContain("src");
    expect(result).toContain("index.ts");
  });

  test("returns manifest when agent matches allowed list", async () => {
    const result = await buildWorkspaceManifestContext({
      config: { enabled: true, agents: ["coder", "reviewer"] },
      graph: mockGraph("└── .\n    └── src"),
      agentId: "coder",
    });
    expect(result).not.toBeNull();
    expect(result).toContain("src");
  });
});

describe("buildSystemPromptWithManifest", () => {
  test("injects workspace manifest into system prompt when config is enabled", async () => {
    const system = await buildSystemPromptWithManifest(
      "You are a helpful assistant.",
      {
        config: { enabled: true, maxDepth: 2 },
        graph: mockGraph("└── .\n    └── _backend\n        └── src"),
      }
    );

    expect(system).toContain("## Workspace Manifest");
    expect(system).toContain("_backend");
  });

  test("returns original prompt when manifest is disabled", async () => {
    const system = await buildSystemPromptWithManifest(
      "You are a helpful assistant.",
      {
        config: { enabled: false },
        graph: mockGraph("src/\n  index.ts"),
      }
    );

    expect(system).toBe("You are a helpful assistant.");
    expect(system).not.toContain("## Workspace Manifest");
  });
});
