/**
 * PTY Host — node-pty under Node.js (Bun cannot load the native addon).
 *
 * Also owns a headless xterm per shell (same model as VS Code's ptyService
 * XtermSerializer): every PTY byte is written into it at the PTY's cols/rows.
 * Snapshots come from that buffer, not from the browser xterm after fit/SIGWINCH.
 *
 * Protocol (stdin -> host):  { id, type: "create"|"write"|"resize"|"kill"|"buffer"|"snapshot", ... }
 * Protocol (host -> stdout): { id, type: "created"|"data"|"exit"|"error"|"buffer"|"snapshot", ... }
 */
"use strict";

const { spawn } = require("node-pty");
const readline = require("node:readline");
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const shells = new Map(); // id -> { pty, buffer, term, serialize }

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function makeHeadless(cols, rows) {
  const term = new Terminal({
    cols: cols || 80,
    rows: rows || 24,
    scrollback: 5000,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  return { term, serialize };
}

function createShell(id, options) {
  try {
    const env = { ...process.env, TERM: "xterm-256color", ...(options.env || {}) };
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const pty = spawn(options.shell || "/bin/bash", options.args || ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: options.cwd || process.cwd(),
      env,
    });
    const { term, serialize } = makeHeadless(cols, rows);
    shells.set(id, { pty, buffer: "", term, serialize });
    emit({ id, type: "created", pid: pty.pid });

    pty.onData((data) => {
      const entry = shells.get(id);
      if (!entry) return;
      entry.buffer += data;
      if (Buffer.byteLength(entry.buffer, "utf8") > 2 * 1024 * 1024) {
        entry.buffer = entry.buffer.slice(-2 * 1024 * 1024);
      }
      entry.pendingWrites = (entry.pendingWrites || 0) + 1;
      entry.term.write(data, () => {
        entry.pendingWrites = Math.max(0, (entry.pendingWrites || 1) - 1);
      });
      emit({ id, type: "data", data });
    });

    pty.onExit(({ exitCode, signal }) => {
      const entry = shells.get(id);
      if (entry) {
        try {
          entry.term.dispose();
        } catch {}
      }
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

function emitSnapshot(id) {
  const entry = shells.get(id);
  if (!entry) {
    emit({ id, type: "snapshot", data: "", cols: 0, rows: 0 });
    return;
  }
  const send = () => {
    try {
      emit({
        id,
        type: "snapshot",
        cols: entry.term.cols,
        rows: entry.term.rows,
        data: entry.serialize.serialize() || "",
      });
    } catch (err) {
      emit({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
      emit({ id, type: "snapshot", data: "", cols: 0, rows: 0 });
    }
  };
  if (!entry.pendingWrites) {
    send();
    return;
  }
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (!entry.pendingWrites || Date.now() - t0 > 200) {
      clearInterval(tick);
      send();
    }
  }, 10);
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
        if (entry) {
          entry.pty.resize(msg.cols, msg.rows);
          entry.term.resize(msg.cols, msg.rows);
        }
        break;
      }
      case "kill": {
        const entry = shells.get(id);
        if (entry) {
          try {
            entry.pty.kill(msg.signal);
          } catch {}
          try {
            entry.term.dispose();
          } catch {}
          shells.delete(id);
        }
        break;
      }
      case "buffer":
        emit({ id, type: "buffer", data: readBuffer(id) });
        break;
      case "snapshot":
        emitSnapshot(id);
        break;
      default:
        break;
    }
  } catch (err) {
    emit({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});

process.stdin.on("end", () => {
  for (const { pty, term } of shells.values()) {
    try {
      pty.kill();
    } catch {}
    try {
      term.dispose();
    } catch {}
  }
  process.exit(0);
});
