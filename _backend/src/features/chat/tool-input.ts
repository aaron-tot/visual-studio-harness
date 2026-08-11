import { jsonrepair } from "jsonrepair";

/**
 * Normalize a tool-call `input`/`args` value into a plain JSON object.
 *
 * The AI SDK forwards the model's raw `function.arguments` string verbatim
 * (it never parses it). If a model emits malformed/double-encoded JSON, the
 * raw string can be persisted as `args` and later re-stringified on the wire,
 * producing `function.arguments` = a JSON *string literal* instead of an
 * object — which strict providers (e.g. Baidu / StreamLake via OpenRouter)
 * reject with HTTP 400.
 *
 * This helper guarantees `args` is always a plain object so the request stays
 * structurally valid. Well-formed inputs pass through untouched; malformed
 * strings are repaired as little as possible (best-effort) rather than dropped.
 */
export function normalizeToolInput(input: unknown): Record<string, unknown> {
  // Already a plain object (and not null/array) → return as-is, no repair.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  // Only strings can represent reparably malformed arguments.
  if (typeof input !== "string") return {};
  const text = input.trim();
  if (!text) return {};

  // Fast path: valid JSON already → parse and validate shape.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Valid JSON but not an object (string/number/etc.) still breaks the wire
    // shape; fall through to skip and produce {}.
  } catch {
    // Invalid JSON → attempt lenient repair below.
  }

  // Lenient repair: `jsonrepair` rescues quotes/braces/commas that models mangle.
  try {
    const repaired = jsonrepair(text);
    const parsed = JSON.parse(repaired);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Repair failed → yield {} so the request remains valid rather than 400ing.
  }

  return {};
}
