import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { DEFAULT_BASH_MAX_BYTES, truncateText } from "../format";

interface Session {
  proc: ChildProcessWithoutNullStreams;
  cwd: string;
  buffer: string;
  waiters: Array<{
    marker: string;
    resolve: (out: { stdout: string; exitCode: number | null }) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

const sessions = new Map<string, Session>();

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

function createSession(sessionId: string, cwd: string): Session {
  const proc = spawn("bash", ["--noprofile", "--norc"], {
    cwd,
    env: {
      ...process.env,
      TERM: "dumb",
      PS1: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session: Session = {
    proc,
    cwd,
    buffer: "",
    waiters: [],
  };

  const onData = (chunk: Buffer) => {
    session.buffer += chunk.toString("utf-8");
    // check waiters for marker
    for (let i = 0; i < session.waiters.length; ) {
      const w = session.waiters[i];
      const idx = session.buffer.indexOf(w.marker);
      if (idx === -1) {
        i++;
        continue;
      }
      const raw = session.buffer.slice(0, idx);
      session.buffer = session.buffer.slice(idx + w.marker.length);
      // parse exit code line just before marker if present
      const exitMatch = raw.match(/__VSH_EXIT:(\d+)\s*$/);
      let stdout = raw;
      let exitCode: number | null = null;
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
        stdout = raw.slice(0, exitMatch.index);
      }
      clearTimeout(w.timer);
      session.waiters.splice(i, 1);
      w.resolve({ stdout, exitCode });
    }
  };

  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("exit", () => {
    sessions.delete(sessionId);
    for (const w of session.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error("ERROR bash: shell session exited"));
    }
    session.waiters = [];
  });

  sessions.set(sessionId, session);
  return session;
}

function getOrCreate(sessionId: string, cwd: string): Session {
  const existing = sessions.get(sessionId);
  if (existing && !existing.proc.killed) {
    return existing;
  }
  return createSession(sessionId, cwd);
}

export async function runInPersistentBash(opts: {
  sessionId: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<{ output: string; exitCode: number | null }> {
  const session = getOrCreate(opts.sessionId, opts.cwd);
  const marker = `__VSH_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

  const resultPromise = new Promise<{ stdout: string; exitCode: number | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.waiters = session.waiters.filter((w) => w.marker !== marker);
      try {
        session.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      sessions.delete(opts.sessionId);
      reject(new Error(`ERROR bash: timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    session.waiters.push({ marker, resolve, reject, timer });

    if (opts.abortSignal) {
      const onAbort = () => {
        session.waiters = session.waiters.filter((w) => w.marker !== marker);
        clearTimeout(timer);
        try {
          session.proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        sessions.delete(opts.sessionId);
        reject(new Error("ERROR bash: aborted"));
      };
      if (opts.abortSignal.aborted) onAbort();
      else opts.abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });

  // Run command, print exit code, then marker on its own line
  const script = [
    `cd ${shellQuote(opts.cwd)} 2>/dev/null || true`,
    opts.command,
    `echo "__VSH_EXIT:$?"`,
    `echo "${marker}"`,
  ].join("\n") + "\n";

  session.proc.stdin.write(script);

  const { stdout, exitCode } = await resultPromise;
  const cleaned = stripAnsi(stdout);
  const { text } = truncateText(cleaned, DEFAULT_BASH_MAX_BYTES);
  return { output: text, exitCode };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function killBashSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    s.proc.kill("SIGKILL");
  } catch {
    // ignore
  }
  sessions.delete(sessionId);
}

export function killAllBashSessions(): void {
  for (const [id] of sessions) {
    killBashSession(id);
  }
}
