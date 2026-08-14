/**
 * Thinking-mode providers (Console Go / DeepSeek-style) reject assistant
 * tool-call messages that omit `reasoning_content` once thinking is active:
 *   "The `reasoning_content` in the thinking mode must be passed back to the API."
 *
 * Real model turns usually carry reasoning. Fabricated turns (e.g. the
 * additional_system_info pair from prepareStep / message-builder replay) and
 * rare tool-only steps do not. AI SDK only emits the key when a reasoning part
 * has non-empty text, so empty-string must be forced on the wire.
 *
 * Spec: ASI stays a fabricated tail injection for prompt-cache (see
 * additional-system-info-cache-spec §4/§6). This only adds the missing field
 * required by thinking gateways; it does not change ASI placement or content.
 */

export function isThinkingEffortOn(effort: string | undefined | null): boolean {
  return !!effort && effort !== "off";
}

/**
 * Ensure every assistant message that has tool_calls also has a
 * `reasoning_content` key (empty string when none). Mutates and returns body.
 */
export function ensureThinkingReasoningContent(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const tcs = m.tool_calls;
    if (!Array.isArray(tcs) || tcs.length === 0) continue;
    if (!("reasoning_content" in m) || m.reasoning_content == null) {
      m.reasoning_content = "";
    }
  }
  return body;
}

/** Wrap fetch so chat/completions bodies get reasoning_content when thinking is on. */
export function withThinkingReasoningEcho(
  fetchImpl: typeof fetch,
  thinkingOn: boolean,
): typeof fetch {
  if (!thinkingOn) return fetchImpl;
  const wrapped: typeof fetch = Object.assign(
    async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      let next = init;
      if (init && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body) as Record<string, unknown>;
          ensureThinkingReasoningContent(parsed);
          next = { ...init, body: JSON.stringify(parsed) };
        } catch {
          /* leave body unchanged */
        }
      }
      return fetchImpl(input, next as RequestInit);
    },
    // preserve preconnect if present (Bun / createVerboseFetch)
    fetchImpl,
  );
  return wrapped;
}
