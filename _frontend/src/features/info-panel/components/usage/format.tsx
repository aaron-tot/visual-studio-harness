/**
 * Pure string formatters — always return strings so () never fail to render.
 */

export function formatTokens(n: number): string {
  const x = Number(n) || 0;
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (x >= 1_000) return (x / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(x));
}

export function formatDuration(ms: number): string {
  const x = Number(ms) || 0;
  if (x >= 60_000) {
    const s = x / 1_000;
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}m ${sec}s`;
  }
  if (x >= 1_000) return (x / 1_000).toFixed(1).replace(/\.0$/, "") + "s";
  return Math.round(x) + "ms";
}

export function formatTokenFlow(input: number, output: number): string {
  return `${Number(input) || 0}→${Number(output) || 0}`;
}

/**
 * `560 tok (1.4k)` when inclusive > own, else `560 tok`.
 * Inclusive is clamped to at least own.
 */
export function formatOwnIncl(own: number, inclusive: number): string {
  const o = Number(own) || 0;
  const i = Math.max(Number(inclusive) || 0, o);
  if (i > o) return `${formatTokens(o)} tok (${formatTokens(i)})`;
  return `${formatTokens(o)} tok`;
}

/** `400 (900)` when inclusive > own, else `400` */
export function formatNumOwnIncl(own: number, inclusive: number): string {
  const o = Number(own) || 0;
  const i = Math.max(Number(inclusive) || 0, o);
  if (i > o) return `${formatTokens(o)} (${formatTokens(i)})`;
  return formatTokens(o);
}

export function formatDurationOwnIncl(ownMs: number, inclusiveMs: number): string {
  const o = Number(ownMs) || 0;
  const i = Math.max(Number(inclusiveMs) || 0, o);
  if (i > o) return `${formatDuration(o)} (${formatDuration(i)})`;
  return formatDuration(o);
}

/**
 * `claude` | `claude (google)` | `claude (many)`
 * Hover title should be set by caller when needed; returns plain string.
 * Also returns { text, title } via formatStringOwnInclParts for tooltips.
 */
export function formatStringOwnIncl(
  primary: string | undefined | null,
  allValues: Array<string | undefined | null>
): string {
  return formatStringOwnInclParts(primary, allValues).text;
}

export function formatStringOwnInclParts(
  primary: string | undefined | null,
  allValues: Array<string | undefined | null>
): { text: string; title?: string } {
  const clean = (v: string | undefined | null) => (v ?? "").trim();
  const unique = [...new Set(allValues.map(clean).filter(Boolean))];
  const main = clean(primary) || unique[0] || "";
  if (!main && unique.length === 0) return { text: "—" };
  if (unique.length <= 1) return { text: main || unique[0] || "—" };

  const others = unique.filter((u) => u !== main);
  if (others.length === 0) return { text: main };

  const title = unique.join("\n");
  if (others.length === 1) {
    return { text: `${main} (${others[0]})`, title };
  }
  return { text: `${main} (many)`, title };
}
