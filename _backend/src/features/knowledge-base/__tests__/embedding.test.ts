import { describe, it, expect } from "bun:test";
import { resolveEmbeddingProvider } from "../embedding/resolve";

describe("embedding provider resolution", () => {
  const providers = [
    {
      displayName: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test", // pragma: allowlist secret
      defaultModel: "gpt-4o",
      headers: {},
      enabled: true,
    },
    {
      displayName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      defaultModel: "nomic-embed-text",
      headers: {},
      enabled: true,
    },
  ];

  it("resolves existing provider by displayName", async () => {
    const provider = await resolveEmbeddingProvider("openai", providers);
    expect(provider).not.toBeNull();
    expect(provider!.displayName).toBe("openai");
    expect(provider!.dimensions).toBe(1536); // text-embedding-3-small
  });

  it("resolves case-insensitively", async () => {
    const provider = await resolveEmbeddingProvider("OpenAI", providers);
    expect(provider).not.toBeNull();
    expect(provider!.displayName).toBe("openai");
  });

  it("returns null for unknown provider", async () => {
    const provider = await resolveEmbeddingProvider("nonexistent", providers);
    expect(provider).toBeNull();
  });

  it("resolves ollama with correct dimensions", async () => {
    const provider = await resolveEmbeddingProvider("ollama", providers);
    expect(provider).not.toBeNull();
    expect(provider!.dimensions).toBe(768); // nomic-embed-text
  });

  it("throws on embed call when API is unreachable", async () => {
    const provider = await resolveEmbeddingProvider("ollama", providers);
    expect(provider).not.toBeNull();
    // This should fail because localhost:11434 isn't running
    await expect(provider!.embed(["test"])).rejects.toThrow();
  });
});
