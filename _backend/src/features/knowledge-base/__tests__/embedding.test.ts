import { describe, it, expect } from "bun:test";
import { resolveEmbeddingProvider } from "../embedding/resolve";

describe("embedding provider resolution", () => {
  const providers = [
    {
      displayName: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test", // pragma: allowlist secret
      headers: {},
      models: [{ displayName: "GPT-4o", modelName: "gpt-4o", enabled: true }],
      enabled: true,
    },
    {
      displayName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      headers: {},
      models: [{ displayName: "Nomic Embed", modelName: "nomic-embed-text", enabled: true }],
      enabled: true,
    },
  ];

  it("resolves existing provider by displayName", async () => {
    const provider = await resolveEmbeddingProvider("openai", providers, "text-embedding-3-small");
    expect(provider).not.toBeNull();
    expect(provider!.displayName).toBe("openai");
    expect(provider!.dimensions).toBe(1536); // text-embedding-3-small
  });

  it("uses the configured model for dimensions", async () => {
    const provider = await resolveEmbeddingProvider("openai", providers, "jina-embeddings-v3");
    expect(provider).not.toBeNull();
    expect(provider!.modelName).toBe("jina-embeddings-v3");
    expect(provider!.dimensions).toBe(1024); // jina-embeddings-v3
  });

  it("resolves case-insensitively", async () => {
    const provider = await resolveEmbeddingProvider("OpenAI", providers);
    expect(provider).not.toBeNull();
    expect(provider!.displayName).toBe("openai");
  });

  it("returns null when providerId is empty (embeddings disabled by design)", async () => {
    const provider = await resolveEmbeddingProvider("", providers);
    expect(provider).toBeNull();
  });

  it("throws when providerId is configured but the provider is missing", async () => {
    await expect(resolveEmbeddingProvider("nonexistent", providers)).rejects.toThrow(
      /not found in configured providers/,
    );
  });

  it("resolves ollama with correct dimensions", async () => {
    const provider = await resolveEmbeddingProvider("ollama", providers, "nomic-embed-text");
    expect(provider).not.toBeNull();
    expect(provider!.dimensions).toBe(768); // nomic-embed-text
  });

  it("throws on embed call when API is unreachable", async () => {
    const provider = await resolveEmbeddingProvider("ollama", providers, "nomic-embed-text");
    expect(provider).not.toBeNull();
    // This should fail because localhost:11434 isn't running
    await expect(provider!.embed(["test"])).rejects.toThrow();
  });
});
