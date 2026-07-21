/**
 * Backend chat streaming debug tracing.
 *
 * Gated behind the same env var the frontend uses, so enabling one enables both
 * ends of the pipe:
 *   VISUAL_STUDIO_HARNESS_DEBUG_CHAT=1 npm run dev   (or set in the process env)
 *
 * Inspect via the backend process stdout (lines prefixed [chat:namespace]).
 */

const ENABLED = process.env.VISUAL_STUDIO_HARNESS_DEBUG_CHAT === "1";

export function chatDebug(namespace: string, message: string, ...args: unknown[]): void {
  if (!ENABLED) return;
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[chat:${namespace}] ${message}`;
  // eslint-disable-next-line no-console
  console.debug(`${ts} ${line}`, ...args);
}
