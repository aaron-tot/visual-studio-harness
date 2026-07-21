/**
 * Format helpers for Usage V2.
 * Keep pure (no React) so they are easy to unit-test.
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

/** `own` or `own (incl)` when inclusive > own */
export function formatOwnIncl(own: number, inclusive: number, unit = ""): string {
  const o = Number(own) || 0;
  const i = Math.max(Number(inclusive) || 0, o);
  const suffix = unit ? ` ${unit}` : "";
  if (i > o) return `${formatTokens(o)}${suffix} (${formatTokens(i)})`;
  return `${formatTokens(o)}${suffix}`;
}

/**
 * `claude` | `claude (google)` | `claude (many)`
 */
export function formatStringOwnIncl(
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
  if (others.length === 1) return { text: `${main} (${others[0]})`, title };
  return { text: `${main} (many)`, title };
}
