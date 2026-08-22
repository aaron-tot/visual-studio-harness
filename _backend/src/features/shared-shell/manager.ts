/** Shared-shell manager: owns per-session shell lifecycle metadata and routes
 *  PTY work through the Node.js PTY host (node-pty). Output streamed over the
 *  host's stdio IPC is broadcast to the frontend via WS and kept in a rolling
 *  buffer so a shell's real transcript is available from the very start.
 */
import { statSync } from "node:fs";
import { appendFileSync, mkdirSync } from "node:fs";
import { broadcastToAll } from "../../ws/configPush";
import { ptyHost } from "./pty-client";
import type { Shell, ShellSnapshot } from "./types";

const OUTPUT_MAX_BYTES = 2 * 1024 * 1024; // rolling buffer cap
const MAX_SHELLS_PER_SESSION = 20;

interface ManagedShell {
  shell: Shell;
  buffer: string;
  /** Last snapshot of the rendered xterm state, persisted by the frontend. */
  snapshot?: ShellSnapshot;
  /** Active command capture. The terminal is NOT altered (no stty/PS1 changes)
   *  so it renders like a real shell: the command echo, its output, and the
   *  next prompt all stream normally. Only lines containing the injected
   *  completion marker are filtered from the GUI broadcast. `partial` buffers
   *  a trailing incomplete line ONLY while it could still become the marker
   *  (a strict prefix split across chunks). `seenMarker` flips once the marker
   *  has been fully observed so no later marker-bearing line can surface. */
  capture?: { endTag: string; done: boolean; partial: string; seenMarker: boolean };
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

  // During a command capture we filter out any line containing the injected
  // completion marker (both the echoed `echo '<marker>'` command AND its output
  // line), so the user sees a clean, real terminal: command echo, output, and
  // the next prompt. Everything else streams unchanged, in order.
  //
  // The marker's endTag appears twice — first inside the echoed `echo '...'`
  // line, then again as its own output line, possibly in different chunks. So
  // we keep stripping marker-bearing lines until capture is cleared, and we
  // buffer a partial tail only while it could still grow into the marker (a
  // strict prefix split across chunks). Anything else — including the shell's
  // trailing prompt, which has no newline until the user types — passes through
  // immediately rather than being swallowed waiting for a newline.
  let visible = msg.data;
  const c = m.capture;
  if (c) {
    const text = c.partial + msg.data;
    const parts = text.split("\n");
    const tail = parts.pop() ?? ""; // last, possibly-unterminated line
    let out = "";
    for (const line of parts) {
      if (line.indexOf(c.endTag) === -1) {
        out += line + "\n";
      } else {
        c.seenMarker = true;
      }
    }
    const holdTail = tail !== "" && !c.seenMarker && c.endTag.startsWith(tail);
    c.partial = holdTail ? tail : "";
    c.done = c.seenMarker;
    visible = out + (holdTail || tail === "" ? "" : tail);
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
 * The command is written normally (so the terminal shows the real echo +
 * output + prompt), followed by an invisible completion marker. The buffer is
 * polled until the marker's echo appears (or `timeoutMs` elapses). Only the
 * command's own stdout (everything after the echoed command line and up to the
 * marker) is returned, stripped of ANSI.
 */
export async function runShellCommand(
  id: string,
  command: string,
  { timeoutMs = 30000 }: { timeoutMs?: number } = {}
): Promise<ShellCommandResult> {
  const m = shellsById.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);

  const startIndex = m.buffer.length;
  const endTag = `__VSH_DONE_${Date.now()}_${Math.random().toString(36).slice(2, 10)}__`;

  // The terminal is left untouched; just run the command and append a marker.
  m.capture = { endTag, done: false, partial: "", seenMarker: false };
  writeToShell(id, `${command}\n`);
  writeToShell(id, `echo '${endTag}'\n`);

  const finish = () => {
    const mm = shellsById.get(id);
    if (mm) {
      mm.capture = undefined;
      // Remove the injected marker lines (the echoed `echo '<marker>'` command
      // and its `marker` output) from the persisted buffer so a later
      // navigate-back / getShellOutput replay stays clean and real-looking.
      mm.buffer = mm.buffer
        .split("\n")
        .filter((line) => line.indexOf(endTag) === -1)
        .join("\n");
    }
  };

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const mm = shellsById.get(id);
      const buffer = mm?.buffer ?? "";
      // Marker appears twice: in the echoed `echo '<endTag>'` command line and
      // once as its output. The LAST occurrence is the output marker.
      const markerPos = buffer.lastIndexOf(endTag);
      const markerStart = markerPos === -1 ? -1 : markerPos + endTag.length;
      if (markerPos !== -1 && markerStart >= markerPos) {
        clearInterval(poll);
        const out = extractStdout(buffer, startIndex, markerStart, markerPos, endTag);
        finish();
        resolve({ output: stripAnsi(out).trim(), timedOut: false });
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        finish();
        resolve({ output: stripAnsi(buffer.slice(startIndex)).trim(), timedOut: true });
        return;
      }
    }, 100);
  });
}

/** Extract the command's stdout: after the echoed command line, before the
 *  marker's output line. The injected `echo '<marker>'` command (which the PTY
 *  echoes verbatim in between) is filtered out so it never reaches the tool. */
function extractStdout(buffer: string, startIndex: number, markerEnd: number, markerPos: number, endTag: string): string {
  const raw = buffer.slice(startIndex);
  // The marker's output line begins at the newline before markerPos.
  const markerLineStart = buffer.lastIndexOf("\n", markerPos) + 1;
  // The command echo line is the first line in `raw` (starts at startIndex).
  const cmdLineEnd = raw.indexOf("\n");
  const outStart = cmdLineEnd === -1 ? 0 : cmdLineEnd + 1;
  // Clip to the marker line start (relative to this slice).
  const outEnd = markerLineStart - startIndex;
  const slice = outEnd <= outStart ? raw.slice(0, Math.max(0, outEnd)) : raw.slice(outStart, outEnd);
  // Drop the echoed `echo '<marker>'` command line (it contains the endTag) so
  // only genuine command output is returned to the agent.
  return slice
    .split("\n")
    .filter((line) => line.indexOf(endTag) === -1)
    .join("\n")
    .replace(/^\s+/, "");
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

/** Fetch a shell's authoritative PTY buffer from the host (falls back to the
 *  in-memory rolling buffer if the host never answers). Raw bytes, ANSI intact. */
async function fetchShellBuffer(id: string): Promise<string> {
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
  return buffer || "";
}

export async function getShellOutput(id: string, opts?: ShellOutputOptions): Promise<string> {
  // Return clean terminal text — strip ANSI/OSC control sequences (title
  // sequences, OSC-8/OSC-3008 json marks, colour codes, \r) so the agent sees
  // roughly what the terminal shows rather than raw escape junk.
  return sliceOutput(stripAnsi(await fetchShellBuffer(id)), opts);
}

/** Like `getShellOutput` but returns the RAW PTY bytes (ANSI/colour codes
 *  intact). Used by the terminal frontend only as a fallback when no snapshot
 *  exists yet; never hand this to the agent. */
export async function getShellOutputRaw(id: string, opts?: ShellOutputOptions): Promise<string> {
  return sliceOutput(await fetchShellBuffer(id), opts);
}

/** Store the last rendered xterm snapshot for a shell so a later frontend
 *  refresh can restore the exact coloured view. Fails loudly on invalid
 *  geometry or empty serialized payload. */
export function setShellSnapshot(id: string, snap: ShellSnapshot): void {
  const m = shellsById.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);
  if (!Number.isInteger(snap.cols) || snap.cols < 1) throw new Error("snapshot cols must be a positive integer");
  if (!Number.isInteger(snap.rows) || snap.rows < 1) throw new Error("snapshot rows must be a positive integer");
  if (typeof snap.serialized !== "string" || snap.serialized.length === 0) {
    throw new Error("snapshot serialized content must be a non-empty string");
  }
  // TEMP DEBUG - remove after diagnosing color loss on refresh
  try {
    mkdirSync("/tmp/vsh-debug", { recursive: true });
    appendFileSync(
      "/tmp/vsh-debug/snapshots.log",
      `${new Date().toISOString()} SET ${id} ${snap.cols}x${snap.rows} len=${snap.serialized.length} esc=${(snap.serialized.match(/\x1b/g) || []).length} first=${JSON.stringify(snap.serialized.slice(0, 80))}\n`
    );
  } catch {}
  m.snapshot = { cols: snap.cols, rows: snap.rows, serialized: snap.serialized, updatedAt: Date.now() };
}

/** Fetch a shell's saved snapshot (or null if none has been written yet). */
export function getShellSnapshot(id: string): ShellSnapshot | null {
  const snap = shellsById.get(id)?.snapshot ?? null;
  // TEMP DEBUG - remove after diagnosing color loss on refresh
  try {
    mkdirSync("/tmp/vsh-debug", { recursive: true });
    appendFileSync(
      "/tmp/vsh-debug/snapshots.log",
      `${new Date().toISOString()} GET ${id} -> ${snap ? `len=${snap.serialized.length} esc=${(snap.serialized.match(/\x1b/g) || []).length} first=${JSON.stringify(snap.serialized.slice(0, 80))}` : "null"}\n`
    );
  } catch {}
  return snap;
}

/** Look up a shell by id, but only if it belongs to `sessionId`. Returns undefined
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
