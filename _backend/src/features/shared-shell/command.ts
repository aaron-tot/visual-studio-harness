export interface ManagedLookup {
  get: (id: string) => { buffer: string; cols: number; rows: number } | undefined;
  write: (id: string, data: string) => void;
}

export interface ShellCommandResult {
  output: string;
  timedOut: boolean;
}

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

function bufferEndsOnPrompt(buffer: string): boolean {
  const last = stripAnsi(buffer).split("\n").pop() ?? "";
  return /[$#]\s*$/.test(last);
}

function extractCommandOutput(buffer: string, startIndex: number): string {
  const raw = stripAnsi(buffer.slice(startIndex));
  const nl = raw.indexOf("\n");
  const afterEcho = nl === -1 ? "" : raw.slice(nl + 1);
  const lines = afterEcho.split("\n");
  if (lines.length > 0 && /[$#]\s*$/.test(lines[lines.length - 1] ?? "")) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

/** Write only `command\\n`. Wait until buffer grows, ends on a prompt, and is still. */
export async function runShellCommandOn(
  lookup: ManagedLookup,
  id: string,
  command: string,
  timeoutMs: number
): Promise<ShellCommandResult> {
  const m = lookup.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);

  if (m.cols === 80 && m.rows === 24) {
    const until = Date.now() + 400;
    while (Date.now() < until) {
      const cur = lookup.get(id);
      if (!cur || cur.cols !== 80 || cur.rows !== 24) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const live = lookup.get(id);
  if (!live) throw new Error(`Shell ${id} not running`);
  const startIndex = live.buffer.length;
  lookup.write(id, `${command}\n`);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let lastLen = startIndex;
    let stillAt = 0;
    const poll = setInterval(() => {
      const buffer = lookup.get(id)?.buffer ?? "";
      if (buffer.length !== lastLen) {
        lastLen = buffer.length;
        stillAt = Date.now();
      }
      const settled = Date.now() - stillAt >= 150;
      if (buffer.length > startIndex && settled && bufferEndsOnPrompt(buffer)) {
        clearInterval(poll);
        resolve({ output: extractCommandOutput(buffer, startIndex), timedOut: false });
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        resolve({ output: extractCommandOutput(buffer, startIndex), timedOut: true });
      }
    }, 50);
  });
}
