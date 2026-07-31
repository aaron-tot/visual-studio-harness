import type { EmbeddingProvider } from "./provider";
import type { ProviderConfig } from "../../../../../_shared/types/config";
import { withRetry } from "./retry";
import { EMBEDDING_RETRIES, EMBEDDING_TIMEOUT_MS } from "../constants";

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
 * The embedding model and its dimensions come from the knowledge config;
 * the provider's baseUrl/apiKey supply the OpenAI-compatible endpoint.
 *
 * Throws when providerId is configured but no matching provider exists —
 * a silent keyword-only fallback would hide the misconfiguration.
 * Returns null only when embedding is intentionally disabled (empty providerId).
 */
export async function resolveEmbeddingProvider(
  providerId: string,
  providers: ProviderConfig[],
  model?: string,
): Promise<EmbeddingProvider | null> {
  if (!providerId) {
    return null;
  }

  const provider = providers.find(
    (p) => p.displayName === providerId || p.displayName.toLowerCase() === providerId.toLowerCase(),
  );

  if (!provider) {
    throw new Error(
      `Embedding provider "${providerId}" is configured in knowledge.embedding.providerId but not found in configured providers. ` +
        `Fix the config or remove knowledge.embedding.providerId to disable embeddings.`,
    );
  }

  // The model to use for embeddings (from knowledge config, falls back to the
  // provider's first enabled model, then to nomic-embed-text).
  const firstEnabledModel = provider.models?.find((m) => m.enabled !== false)?.modelName;
  const modelName = model || firstEnabledModel || "nomic-embed-text";
  const dimensions = EMBEDDING_DIMENSIONS[modelName] || 768;

  return {
    displayName: provider.displayName,
    modelName,
    dimensions,
    async embed(texts: string[], embedModel?: string): Promise<number[][]> {
      const resolvedModel = embedModel || modelName;
      const url = `${provider.baseUrl.replace(/\/+$/, "")}/embeddings`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(provider.headers || {}),
      };
      if (provider.apiKey) {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }

      return withRetry(async () => {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: texts,
            model: resolvedModel,
          }),
          signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          const err = new Error(`Embedding API error (${response.status}): ${errorText}`) as Error & {
            status?: number;
            retryAfterMs?: number;
          };
          err.status = response.status;
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) {
            err.retryAfterMs = Number(retryAfter) * 1000;
          }
          throw err;
        }

        const data = await response.json() as {
          data: Array<{ embedding: number[] }>;
        };

        if (!data.data || !Array.isArray(data.data)) {
          throw new Error(`Unexpected embedding API response format`);
        }

        return data.data.map((d) => d.embedding);
      }, { retries: EMBEDDING_RETRIES });
    },
  };
}
