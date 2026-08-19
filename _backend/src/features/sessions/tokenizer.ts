/**
 * Token counting for summarizer input sizing.
 *
 * Pre-call block sizing must measure the ACTUAL text that will be sent to the
 * summarizer (prompt + prior summary + covered turn text), not the main model's
 * per-turn `totalTokens` (which includes output/reasoning and reflects a
 * different model's vocabulary). This module uses the `gpt-tokenizer` library
 * (cl100k_base) for a deterministic, real tokenizer count — no chars/4 heuristic.
 */
import { encode } from "gpt-tokenizer";

/**
 * Count tokens for a single piece of text.
 * Falls back to a conservative ceiling (ceil(chars/1)) only if the tokenizer
 * itself fails, which is a safety floor for fit decisions, never a silent
 * success path.
 */
export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    // Every char as its own token is an upper bound — safer than under-counting
    // when sizing across a block boundary.
    return text.length;
  }
}

/**
 * Count tokens for a messages array of the shape the summarizer receives
 * (`buildSummarizationMessages` output). Each message carries an "\n\n" plus
 * role/content overhead; tokenizing the serialized text keeps the estimate
 * close to what the provider counts.
 */
export function estimateMessagesTokens(
  messages: { role: string; content: string }[],
): number {
  let total = 0;
  for (const m of messages) {
    // ~4 tokens of per-message framing (role + whitespace) + content.
    total += 4 + countTokens(m.content ?? "");
  }
  return total;
}
