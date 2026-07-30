import type { EmbeddingProvider } from "./provider";
import type { ProviderConfig } from "../../../../../_shared/types/config";

const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "jina-embeddings-v3": 1024,
  "nomic-embed-text": 768,
  "all-MiniLM-L6-v2": 384,
  "gte-small": 384,
  "gte-base": 768,
  "gte-large": 1024,
};

/**
 * Resolve an embedding provider from the configured providers list.
 * Looks up by providerId (displayName match).
 * Returns null if not found — letting the caller fall back to keyword-only search.
 */
export async function resolveEmbeddingProvider(
  providerId: string,
  providers: ProviderConfig[],
): Promise<EmbeddingProvider | null> {
  const provider = providers.find(
    (p) => p.displayName === providerId || p.displayName.toLowerCase() === providerId.toLowerCase(),
  );

  if (!provider) {
    console.warn(`[knowledge] Embedding provider "${providerId}" not found in configured providers — fallback to keyword-only search`);
    return null;
  }

  // The model to use for embeddings
  const model = providerId === "openai" ? "text-embedding-3-small" : "nomic-embed-text";
  const dimensions = EMBEDDING_DIMENSIONS[model] || 768;

  return {
    displayName: provider.displayName,
    dimensions,
    async embed(texts: string[], embedModel?: string): Promise<number[][]> {
      const modelName = embedModel || model;
      const url = `${provider.baseUrl.replace(/\/+$/, "")}/embeddings`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(provider.headers || {}),
      };
      if (provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: texts,
          model: modelName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Embedding API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error(`Unexpected embedding API response format`);
      }

      return data.data.map((d) => d.embedding);
    },
  };
}
