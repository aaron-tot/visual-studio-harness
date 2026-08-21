/**
 * PTY Host — runs node-pty (a real pseudo-terminal) under Node.js.
 *
 * Bun cannot load node-pty's native addon (ABI mismatch), so this process runs
 * under `node`. The Bun backend spawns it and talks to it over stdio using
 * newline-delimited JSON.
 *
 * Protocol (stdin -> host):  { id, type: "create"|"write"|"resize"|"kill", ... }
 * Protocol (host -> stdout): { id, type: "created"|"data"|"exit"|"error", ... }
 */
"use strict";

const { spawn } = require("node-pty");
const readline = require("node:readline");

const shells = new Map(); // id -> { pty, buffer }

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function createShell(id, options) {
  try {
    const env = { ...process.env, TERM: "xterm-256color", ...(options.env || {}) };
    const pty = spawn(options.shell || "/bin/bash", options.args || ["-l"], {
      name: "xterm-256color",
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || process.cwd(),
      env,
    });
    shells.set(id, { pty, buffer: "" });
    emit({ id, type: "created", pid: pty.pid });

    pty.onData((data) => {
      const entry = shells.get(id);
      if (!entry) return;
      entry.buffer += data;
      if (Buffer.byteLength(entry.buffer, "utf8") > 2 * 1024 * 1024) {
        entry.buffer = entry.buffer.slice(-2 * 1024 * 1024);
      }
      emit({ id, type: "data", data });
    });

    pty.onExit(({ exitCode, signal }) => {
      shells.delete(id);
      emit({ id, type: "exit", exitCode, signal: signal || null });
    });
  } catch (err) {
    emit({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

function readBuffer(id) {
  const entry = shells.get(id);
  return entry ? entry.buffer : "";
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, type } = msg;
  try {
    switch (type) {
      case "create":
        createShell(id, msg.options || {});
        break;
      case "write": {
        const entry = shells.get(id);
        if (entry) entry.pty.write(msg.data);
        break;
      }
      case "resize": {
        const entry = shells.get(id);
        if (entry) entry.pty.resize(msg.cols, msg.rows);
        break;
      }
      case "kill": {
        const entry = shells.get(id);
        if (entry) {
          try {
            entry.pty.kill(msg.signal);
          } catch {}
          shells.delete(id);
        }
        break;
      }
      case "buffer":
        emit({ id, type: "buffer", data: readBuffer(id) });
        break;
      default:
        break;
    }
  } catch (err) {
    emit({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});

process.stdin.on("end", () => {
  for (const { pty } of shells.values()) {
    try {
      pty.kill();
    } catch {}
  }
  process.exit(0);
});
