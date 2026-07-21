import type { ThinkingEffort } from "../../../_shared/types";

/**
 * Map thinking effort to AI SDK / OpenAI-compatible provider options.
 * Best-effort: many backends ignore unknown fields.
 */
export function thinkingToProviderOptions(
  effort: ThinkingEffort | undefined
): Record<string, unknown> | undefined {
  if (!effort || effort === "off") return undefined;

  // Common OpenAI-compatible reasoning controls
  return {
    openaiCompatible: {
      reasoningEffort: effort,
    },
  };
}
