/** Strip CSI / OSC so wrap detection sees the visible prompt text. */
function visibleText(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[\x40-\x7e]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b./g, "")
    .replace(/\r/g, "");
}

/** SIGWINCH leftover: user@host:path fragment with no `/** Strip CSI / OSC so wrap detection sees the visible prompt text. */
function visibleText(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[\x40-\x7e]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b./g, "")
    .replace(/\r/g, "");
}

/`#` prompt char.
 *  A real command echo is `user@host:path$ cmd` (has `/** Strip CSI / OSC so wrap detection sees the visible prompt text. */
function visibleText(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[\x40-\x7e]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b./g, "")
    .replace(/\r/g, "");
}

). A finished prompt
 *  is `user@host:path$ `. Wrap fragments have neither. */
function isBrokenPrompt(visible: string): boolean {
  if (!visible) return false;
  if (/[$#]/.test(visible)) return false;
  return /@/.test(visible) && /:/.test(visible);
}

/**
 * Bash reprints PS1 on SIGWINCH with CR and leaves wrapped fragments on
 * previous rows. addon-serialize records those cells. Drop incomplete
 * prompt lines so a refresh cannot replay them.
 */
export function cleanSnapshot(serialized: string): string {
  const lines = serialized.split("\r\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (isBrokenPrompt(visibleText(line))) continue;
    kept.push(line);
  }
  return kept.join("\r\n");
}
