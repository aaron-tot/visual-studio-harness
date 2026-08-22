/** Shared-shell manager: owns per-session shell lifecycle metadata and routes
 *  PTY work through the Node.js PTY host (node-pty). Output streamed over the
 *  host's stdio IPC is broadcast to the frontend via WS and kept in a rolling
 *  buffer so a shell's real transcript is available from the very start.
 */
import { statSync } from "node:fs";
import { broadcastToAll } from "../../ws/configPush";
import { ptyHost } from "./pty-client";
import type { Shell, ShellSnapshot } from "./types";
import { validateSnapshot, fetchHostSnapshot, formatShellOutput } from "./snapshot";
import type { ShellOutputOptions } from "./snapshot";
import { runShellCommandOn } from "./command";
import type { ShellCommandResult } from "./command";
export type { ShellCommandResult, ShellOutputOptions };

const OUTPUT_MAX_BYTES = 2 * 1024 * 1024; // rolling buffer cap
const MAX_SHELLS_PER_SESSION = 20;

interface ManagedShell {
  shell: Shell;
  buffer: string;
  cols: number;
  rows: number;
  /** Last snapshot of the rendered xterm state, persisted by the frontend. */
  snapshot?: ShellSnapshot;
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

  broadcastToAll({
    type: "shell:output",
    payload: { id: msg.id, sessionId: m.shell.sessionId, data: msg.data },
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

  shellsById.set(id, { shell, buffer: "", cols: 80, rows: 24 });
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
  const m = shellsById.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new Error("cols and rows must be positive integers");
  }
  m.cols = cols;
  m.rows = rows;
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

export async function runShellCommand(
  id: string,
  command: string,
  { timeoutMs = 30000 }: { timeoutMs?: number } = {}
): Promise<ShellCommandResult> {
  return runShellCommandOn(
    { get: (sid) => shellsById.get(sid), write: writeToShell },
    id,
    command,
    timeoutMs
  );
}

export async function getShellOutput(id: string, opts?: ShellOutputOptions): Promise<string> {
  const m = shellsById.get(id);
  if (!m) return "";
  return formatShellOutput(id, m.buffer, opts, false);
}

export async function getShellOutputRaw(id: string, opts?: ShellOutputOptions): Promise<string> {
  const m = shellsById.get(id);
  if (!m) return "";
  return formatShellOutput(id, m.buffer, opts, true);
}

/** Store the last rendered xterm snapshot for a shell so a later frontend
 *  refresh can restore the exact coloured view. Fails loudly on invalid
 *  geometry or empty serialized payload. */
export function setShellSnapshot(id: string, snap: ShellSnapshot): void {
  const m = shellsById.get(id);
  if (!m) throw new Error(`Shell ${id} not running`);
  m.snapshot = validateSnapshot(snap);
}

/** Headless xterm snapshot from the PTY host. Frontend persist is fallback only. */
export async function getShellSnapshot(id: string): Promise<ShellSnapshot | null> {
  const m = shellsById.get(id);
  if (!m) return null;
  return (await fetchHostSnapshot(id)) ?? m.snapshot ?? null;
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
