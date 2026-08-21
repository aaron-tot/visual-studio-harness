/** Shared-shell manager: owns per-session shell lifecycle metadata and routes
 *  PTY work through the Node.js PTY host (node-pty). Output streamed over the
 *  host's stdio IPC is broadcast to the frontend via WS and kept in a rolling
 *  buffer so a shell's real transcript is available from the very start.
 */
import { statSync } from "node:fs";
import { broadcastToAll } from "../../ws/configPush";
import { ptyHost } from "./pty-client";
import type { Shell } from "./types";

const OUTPUT_MAX_BYTES = 2 * 1024 * 1024; // rolling buffer cap
const MAX_SHELLS_PER_SESSION = 20;

interface ManagedShell {
  shell: Shell;
  buffer: string;
  /** Active command capture: suppress wrapper/sentinel noise from the WS
   *  broadcast while a runShellCommand is in flight, so the user's terminal
   *  only shows the command's real output. */
  capture?: { startTag: string; endTag: string; done: boolean };
}

const shellsById = new Map<string, ManagedShell>();
const shellsBySession = new Map<string, Map<string, ManagedShell>>();
let hostReady: Promise<void> | null = null;

function ensureHost(): Promise<void> {
  if (!hostReady) {
    hostReady = ptyHost.connect().catch((err) => {
      hostReady = null;
      throw err;
    });
  }
  return hostReady;
}

function makeShellId(): string {
  return `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitCreated(shell: Shell): void {
  broadcastToAll({ type: "shell:created", payload: { shell } });
}

function onHostData(msg: { id: string; data?: string }): void {
  const m = shellsById.get(msg.id);
  if (!m || msg.data === undefined) return;
  const prevLen = m.buffer.length;
  m.buffer += msg.data;
  if (Buffer.byteLength(m.buffer, "utf8") > OUTPUT_MAX_BYTES) {
    m.buffer = m.buffer.slice(-OUTPUT_MAX_BYTES);
  }

  // Suppress capture-wrapper noise (the `stty -echo; PS1=...` preface, the
  // sentinel echoes, and the post-command reset) from what the user sees, while
  // keeping the full transcript in `buffer` for runShellCommand parsing. The
  // user then sees only the command's own output during a capture.
  let visible = msg.data;
  if (m.capture && !m.capture.done) {
    const c = m.capture;
    const curLen = m.buffer.length;
    // The tag appears twice when a preface command echoes the tag text: once in
    // the echoed command line and again as the actual `echo` output. We always
    // key off the LAST occurrence (the echo output).
    const startPos = m.buffer.lastIndexOf(c.startTag);
    const endPos = m.buffer.lastIndexOf(c.endTag);

    let visStart = -1;
    if (startPos !== -1) {
      const nl = m.buffer.indexOf("\n", startPos + c.startTag.length);
      visStart = nl === -1 ? startPos + c.startTag.length : nl + 1;
    }
    let visEnd = curLen;
    if (endPos !== -1) {
      const lineStart = m.buffer.lastIndexOf("\n", endPos) + 1;
      visEnd = lineStart;
      if (endPos + c.endTag.length <= curLen) c.done = true;
    }

    // Broadcast only the intersection of the visible region with this chunk.
    const from = Math.max(prevLen, visStart);
    const to = Math.min(curLen, visEnd);
    visible = to > from ? msg.data.slice(from - prevLen, to - prevLen) : "";
  }

  broadcastToAll({
    type: "shell:output",
    payload: { id: msg.id, sessionId: m.shell.sessionId, data: visible },
  });
}

function onHostExit(msg: { id: string; exitCode?: number; signal?: number | null }): void {
  const m = shellsById.get(msg.id);
  if (!m) return;
  m.shell.status = "stopped";
  shellsById.delete(msg.id);
  shellsBySession.get(m.shell.sessionId)?.delete(msg.id);
  // Real removal: the shell is gone, so tell every client to drop it from the
  // UI list (a bare status change would leave a dead shell lingering).
  broadcastToAll({
    type: "shell:closed",
    payload: { id: msg.id, sessionId: m.shell.sessionId },
  });
}

function onHostCreated(msg: { id: string; pid?: number }): void {
  const m = shellsById.get(msg.id);
  if (m) m.shell.status = "running";
}

function onHostError(msg: { id: string; message?: string }): void {
  const m = shellsById.get(msg.id);
  if (m) m.shell.status = "error";
  broadcastToAll({
    type: "shell:updated",
    payload: { id: msg.id, sessionId: m?.shell.sessionId, status: "error", message: msg.message },
  });
}

// Wire host events once (module-level is safe; pty-host is a singleton).
ptyHost.on("data", onHostData);
ptyHost.on("exit", onHostExit);
ptyHost.on("created", onHostCreated);
ptyHost.on("error", onHostError);

export async function createShell(opts: { sessionId: string; name?: string; cwd?: string }): Promise<Shell> {
  await ensureHost();

  const sessionId = opts.sessionId?.trim();
  if (!sessionId) throw new Error("sessionId is required to create a shell");

  // Resolve the working directory up-front and fail loudly if it cannot be
  // used — a node-pty spawn with an invalid cwd silently produces an unusable
  // shell, which is what made shells appear "created" but unreachable.
  const cwd = opts.cwd?.trim() || process.cwd();
  try {
    const st = statSync(cwd);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot create shell in cwd "${cwd}": ${reason}`);
  }

  const sessionMap = shellsBySession.get(sessionId) ?? new Map();
  if (sessionMap.size >= MAX_SHELLS_PER_SESSION) {
    throw new Error(`Too many shells for this session (max ${MAX_SHELLS_PER_SESSION})`);
  }

  const id = makeShellId();
  const shell: Shell = {
    id,
    name: opts.name ?? `Shell ${sessionMap.size + 1}`,
    sessionId,
    status: "starting",
    cwd,
    createdAt: Date.now(),
  };

  shellsById.set(id, { shell, buffer: "" });
  sessionMap.set(id, shellsById.get(id)!);
  shellsBySession.set(sessionId, sessionMap);

  ptyHost.create(id, {
    shell: "/bin/bash",
    args: ["-l"],
    cwd,
    cols: 80,
    rows: 24,
  });

  emitCreated(shell);
  return shell;
}

export function writeToShell(id: string, data: string): void {
  if (!shellsById.has(id)) throw new Error(`Shell ${id} not running`);
  ptyHost.write(id, data);
}

export function resizeShell(id: string, cols: number, rows: number): void {
  if (!shellsById.has(id)) throw new Error(`Shell ${id} not running`);
  ptyHost.resize(id, cols, rows);
}

export function closeShell(id: string): void {
  ptyHost.kill(id);
  const m = shellsById.get(id);
  if (m) {
    shellsBySession.get(m.shell.sessionId)?.delete(id);
    shellsById.delete(id);
    // Tell every client to drop the shell from its UI list (local kill below may
    // race the host exit event, and onHostExit would early-return once removed).
    broadcastToAll({
      type: "shell:closed",
      payload: { id, sessionId: m.shell.sessionId },
    });
  }
}

export function listShells(sessionId: string): Shell[] {
  const sessionMap = shellsBySession.get(sessionId);
  if (!sessionMap) return [];
  return [...sessionMap.values()].map((m) => ({ ...m.shell }));
}

/** Strip ANSI escape/control sequences and CR chars from captured output. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") // colour/SGR + cursor CSI sequences
    // OSC strings (title, OSC-8/OSC-3008 json marks). Stop at ESC or BEL so a
    // ST-terminated OSC (`ESC \`) can never swallow later command output.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\r/g, "");
}

/** Result of an agent-driven command execution. */
export interface ShellCommandResult {
  output: string;
  timedOut: boolean;
}

/**
 * Run `command` in the live shell and wait for its output.
 *
 * The command + a unique completion marker are written to the PTY, then the
 * shell's buffer is polled until the marker appears (or `timeoutMs` elapses).
 * Everything written after the command began and up to the marker is returned
 * (with ANSI codes stripped). This lets `sendCommand` come back with the actual
 * command output rather than "command sent" — waiting as long as needed.
 *
 * Note: output is captured from the shared rolling buffer, so it is also
 * streamed live to the GUI as usual. Because the shell is interactive, this
 * waits for the marker to print; interactive/long-running commands will hit the
 * timeout and return whatever was produced so far.
 */
export async function runShellCommand(
  id: string,
  command: string,
  { timeoutMs = 30000 }: { timeoutMs?: number } = {}
): Promise<ShellCommandResult> {
  const m = shellsById.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);

  const startIndex = m.buffer.length;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const startTag = `VSH_OUT_START_${token}`;
  const endTag = `VSH_OUT_END_${token}`;

  // Disable input echo + clear PS1 for the duration of the capture so the
  // returned text is ONLY the command's actual output — not the echoed command
  // line or the prompt. The command runs between two unique sentinel echoes.
  // The capture flag also makes onHostData hide this wrapper noise from the
  // user's GUI terminal (only the real output is broadcast).
  m.capture = { startTag, endTag, done: false };
  writeToShell(id, `stty -echo; PS1=''; echo ${startTag}\n`);
  writeToShell(id, `${command}\n`);
  writeToShell(id, `echo ${endTag}; stty echo; PS1='\\u@\\h:\\w\\$ '\n`);

  const finish = () => {
    const mm = shellsById.get(id);
    if (mm) mm.capture = undefined;
  };

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const mm = shellsById.get(id);
      const buffer = mm?.buffer ?? "";
      const startPos = buffer.lastIndexOf(startTag);
      const endPos = buffer.lastIndexOf(endTag);
      if (startPos !== -1 && endPos > startPos) {
        clearInterval(poll);
        const out = buffer.slice(startPos + startTag.length, endPos);
        finish();
        resolve({ output: stripAnsi(out).trim(), timedOut: false });
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        const out = buffer.slice(startIndex);
        finish();
        resolve({ output: stripAnsi(out).trim(), timedOut: true });
        return;
      }
    }, 100);
  });
}

export interface ShellOutputOptions {
  /** Max characters to return (default: full buffer). */
  limit?: number;
  /** When limit set: true (default) takes the LAST `limit` chars, false takes the FIRST `limit`. */
  tail?: boolean;
  /** Return only the last N lines (newline-delimited), overriding char slicing. */
  lines?: number;
}

function sliceOutput(raw: string, opts: ShellOutputOptions | undefined): string {
  if (!opts) return raw;
  if (opts.lines !== undefined && opts.lines >= 0) {
    // Keep the trailing empty segment so a trailing "\n" isn't dropped.
    const parts = raw.split("\n");
    return parts.slice(-(Math.min(opts.lines, parts.length - 1) + 1)).join("\n");
  }
  if (opts.limit !== undefined && opts.limit >= 0) {
    const limit = opts.limit;
    if (limit === 0) return "";
    return opts.tail === false ? raw.slice(0, limit) : raw.slice(-limit);
  }
  return raw;
}

export async function getShellOutput(id: string, opts?: ShellOutputOptions): Promise<string> {
  const m = shellsById.get(id);
  if (!m) return "";
  // Ask the host for its authoritative buffer, so we include any bytes the
  // host captured before a reconnect or a frontend refresh.
  const buffer = await new Promise<string>((resolve) => {
    let done = false;
    const handler = (reply: { id: string; type: string; data?: string }) => {
      if (reply.id === id && reply.type === "buffer") {
        done = true;
        ptyHost.off("buffer", handler);
        resolve(reply.data ?? "");
      }
    };
    ptyHost.on("buffer", handler);
    ptyHost.requestBuffer(id);
    setTimeout(() => {
      if (!done) {
        ptyHost.off("buffer", handler);
        resolve(m.buffer);
      }
    }, 500);
  });
  // Return clean terminal text — strip ANSI/OSC control sequences (title
  // sequences, OSC-8/OSC-3008 json marks, colour codes, \r) so the agent sees
  // roughly what the terminal shows rather than raw escape junk.
  return sliceOutput(stripAnsi(buffer || ""), opts);
}

/**
 * Look up a shell by id, but only if it belongs to `sessionId`. Returns undefined
 * when the shell does not exist OR belongs to a different session — used by the
 * agent tool to enforce per-session scoping.
 */
export function getShellForSession(sessionId: string, id: string): Shell | undefined {
  const m = shellsById.get(id);
  if (!m || m.shell.sessionId !== sessionId) return undefined;
  return { ...m.shell };
}

export function closeAllShellsForSession(sessionId: string): void {
  const sessionMap = shellsBySession.get(sessionId);
  if (!sessionMap) return;
  for (const id of [...sessionMap.keys()]) {
    ptyHost.kill(id);
    shellsById.delete(id);
    broadcastToAll({
      type: "shell:closed",
      payload: { id, sessionId },
    });
  }
  shellsBySession.delete(sessionId);
}

export function closeAllShells(): void {
  const ids = [...shellsById.keys()];
  for (const id of ids) {
    ptyHost.kill(id);
    const m = shellsById.get(id);
    broadcastToAll({
      type: "shell:closed",
      payload: { id, sessionId: m?.shell.sessionId },
    });
  }
  shellsById.clear();
  shellsBySession.clear();
  ptyHost.close();
}
