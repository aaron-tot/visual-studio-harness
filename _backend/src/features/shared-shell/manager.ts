/** Shared-shell manager: spawns a persistent bash process per shell, keyed by
 *  shell id, grouped by session. Commands written to stdin; output captured
 *  into a rolling buffer and broadcast over WS.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { broadcastToAll } from "../../ws/configPush";
import type { Shell } from "./types";

const OUTPUT_MAX_BYTES = 256 * 1024; // rolling buffer cap
const MAX_SHELLS_PER_SESSION = 20;

interface ManagedShell {
  shell: Shell;
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
}

const shellsById = new Map<string, ManagedShell>();
const shellsBySession = new Map<string, Map<string, ManagedShell>>();

function makeShellId(): string {
  return `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function onData(id: string, chunk: Buffer): void {
  const m = shellsById.get(id);
  if (!m) return;
  const text = chunk.toString("utf-8");
  m.buffer += text;
  if (Buffer.byteLength(m.buffer, "utf-8") > OUTPUT_MAX_BYTES) {
    m.buffer = m.buffer.slice(-OUTPUT_MAX_BYTES);
  }
  broadcastToAll({ type: "shell:output", payload: { id, sessionId: m.shell.sessionId, data: text } });
}

function onExit(id: string): void {
  const m = shellsById.get(id);
  if (!m) return;
  m.shell.status = "stopped";
  shellsById.delete(id);
  shellsBySession.get(m.shell.sessionId)?.delete(id);
  broadcastToAll({
    type: "shell:updated",
    payload: { id, sessionId: m.shell.sessionId, status: "stopped" },
  });
}

export function createShell(opts: {
  sessionId: string;
  name?: string;
  cwd?: string;
}): Shell {
  const sessionMap = shellsBySession.get(opts.sessionId) ?? new Map();
  if (sessionMap.size >= MAX_SHELLS_PER_SESSION) {
    throw new Error(`Too many shells for this session (max ${MAX_SHELLS_PER_SESSION})`);
  }

  const id = makeShellId();
  const cwd = opts.cwd || process.cwd();
  const proc = spawn("bash", ["--noprofile", "--norc", "-i"], {
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      PS1: `[${opts.sessionId.slice(0, 8)}] $ `,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const shell: Shell = {
    id,
    name: opts.name ?? `Shell ${sessionMap.size + 1}`,
    sessionId: opts.sessionId,
    status: "running",
    cwd,
    createdAt: Date.now(),
  };

  const managed: ManagedShell = { shell, proc, buffer: "" };
  shellsById.set(id, managed);
  sessionMap.set(id, managed);
  shellsBySession.set(opts.sessionId, sessionMap);

  proc.stdout.on("data", (d: Buffer) => onData(id, d));
  proc.stderr.on("data", (d: Buffer) => onData(id, d));
  proc.on("exit", () => onExit(id));

  broadcastToAll({ type: "shell:created", payload: { shell } });
  return shell;
}

export function writeToShell(id: string, data: string): void {
  const m = shellsById.get(id);
  if (!m || m.proc.killed) throw new Error(`Shell ${id} not running`);
  m.proc.stdin.write(data);
}

export function closeShell(id: string): void {
  const m = shellsById.get(id);
  if (!m) return;
  try {
    m.proc.kill("SIGTERM");
    // Ensure a hard kill if graceful termination does not complete quickly.
    setTimeout(() => {
      const cur = shellsById.get(id);
      if (cur && cur.proc.exitCode === null) cur.proc.kill("SIGKILL");
    }, 500);
  } catch {
    /* ignore */
  }
}

export function listShells(sessionId: string): Shell[] {
  const sessionMap = shellsBySession.get(sessionId);
  if (!sessionMap) return [];
  return [...sessionMap.values()].map((m) => ({ ...m.shell }));
}

export function getShellOutput(id: string): string {
  const m = shellsById.get(id);
  return m ? m.buffer : "";
}

export function closeAllShellsForSession(sessionId: string): void {
  const sessionMap = shellsBySession.get(sessionId);
  if (!sessionMap) return;
  for (const id of [...sessionMap.keys()]) {
    closeShell(id);
  }
  shellsBySession.delete(sessionId);
}

/** Close every shell (app shutdown). */
export function closeAllShells(): void {
  for (const id of [...shellsById.keys()]) {
    closeShell(id);
  }
  shellsById.clear();
  shellsBySession.clear();
}
