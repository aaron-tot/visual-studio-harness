/**
 * Local-timezone ISO 8601 string (e.g. "2026-07-30T02:17:07.646-05:00").
 * Uses the runtime system timezone offset.
 */
export function localISOString(): string {
  const d = new Date();
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const hh = pad(Math.floor(offset / 60));
  const mm = pad(offset % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}${sign}${hh}:${mm}`;
}
