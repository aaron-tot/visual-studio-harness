/** PTY client (Bun side): spawns the Node.js PTY host and communicates over
 *  stdio JSON-lines. node-pty must run under Node (Bun ABI is incompatible), so
 *  this process is a `node` child whose stdin/stdout carry framed messages.
 *
 *  Dev runs the host straight from the repo (pty-host.cjs beside this file and
 *  node-pty from node_modules). A compiled binary has neither on disk — the
 *  embedded PTY runtime (host + node-pty JS/native) is materialized to the
 *  runtime data dir and the host is spawned from there.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { resolveDataDir } from "../../paths";
import { PTY_RUNTIME_EMBED } from "../../generated/pty-runtime-embed";

interface PtyHostMessage {
  id: string;
  type: "created" | "data" | "exit" | "error" | "buffer" | "snapshot";
  pid?: number;
  data?: string;
  cols?: number;
  rows?: number;
  exitCode?: number;
  signal?: number | null;
  message?: string;
}

/** True if `bin`, when run, reports a real Node.js version (not Bun's shim). */
function isRealNode(bin: string): boolean {
  try {
    const probe = Bun.spawnSync([bin, "--version"], { stdout: "pipe" });
    if (probe.exitCode !== 0) return false;
    const out = (probe.stdout?.toString() ?? "").trim();
    // Real node prints "v<major>.<minor>.<patch>". Bun's `node` shim prints a
    // version without the leading "v" or otherwise is not a node build.
    return /^v\d+\.\d+\.\d+$/.test(out);
  } catch {
    return false;
  }
}

function findNode(): string {
  const fromEnv = process.env.NODE_BIN;
  if (fromEnv && isRealNode(fromEnv)) return fromEnv;

  // Prefer a real Node from nvm before trusting PATH/Bun.which — under Bun, PATH
  // can contain Bun's own `node` shim (`/tmp/bun-node-*/node`) which is actually
  // Bun and would crash native node-pty.
  const nvm = process.env.HOME ? `${process.env.HOME}/.nvm/versions/node` : null;
  if (nvm) {
    try {
      const ls = Bun.spawnSync(["ls", nvm], { stdout: "pipe" }).stdout?.toString() ?? "";
      const versions = ls
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .reverse();
      for (const v of versions) {
        const bin = join(nvm, v, "bin", "node");
        if (isRealNode(bin)) return bin;
      }
    } catch {
      /* no nvm dir */
    }
  }

  // Fall back to name lookup, still requiring a REAL node.
  for (const name of ["node", "nodejs"]) {
    const p = Bun.which(name);
    if (p && isRealNode(p)) return p;
  }

  throw new Error("shared-shell: could not locate a real node binary (set NODE_BIN)");
}

/**
 * Resolve the PTY host script path.
 *
 * Dev: the repo source tree has `pty-host.cjs` beside this file, spawned
 * directly (node-pty resolves from the repo node_modules).
 *
 * Compiled binary: the repo files aren't on disk, so the embed map is
 * materialized under the runtime data dir (a `node_modules/node-pty` layout so
 * the host's `require("node-pty")` resolves) and the host is spawned from there.
 */
let materializePromise: Promise<string> | null = null;

async function materializeHost(): Promise<string> {
  const embeddedKeys = Object.keys(PTY_RUNTIME_EMBED);
  // Dev: no embedded runtime — use the source copy.
  if (embeddedKeys.length === 0) {
    return join(dirname(fileURLToPath(import.meta.url)), "pty-host.cjs");
  }

  const base = join(resolveDataDir(), "pty-runtime");

  // Layout:
  //   <base>/pty-host.cjs                     (the host script; requires "node-pty")
  //   <base>/node_modules/node-pty/...      (so require("node-pty") resolves)
  let hostDst = "";
  for (const rel of embeddedKeys) {
    const parts = rel.split("/").filter((p) => p && p !== "." && p !== "..");
    let dest: string;
    if (parts[0] === "pty-host") {
      dest = join(base, ...parts.slice(1));
      if (parts.length >= 2 && parts[parts.length - 1] === "pty-host.cjs") hostDst = dest;
    } else {
      // everything else is the node-pty package tree
      dest = join(base, "node_modules", ...parts);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(PTY_RUNTIME_EMBED[rel], "base64"));
  }
  return hostDst;
}

/** Absolute path to the PTY host script (cache the async materialization). */
function hostPath(): string | Promise<string> {
  if (Object.keys(PTY_RUNTIME_EMBED).length === 0) {
    return join(dirname(fileURLToPath(import.meta.url)), "pty-host.cjs");
  }
  if (!materializePromise) materializePromise = materializeHost();
  return materializePromise;
}

class PtyHostClient extends EventEmitter {
  private child: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private buffer = "";

  async connect(): Promise<void> {
    if (this.child) return;
    const nodeBin = findNode();
    const host = await hostPath();
    const proc = Bun.spawn([nodeBin, host], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
    this.child = proc;

    proc.stdout.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => this.onChunk(chunk),
      })
    ).catch(() => {});

    // Surface the node host's stderr to the backend log for diagnostics.
    proc.stderr?.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => {
          const text = Buffer.from(chunk).toString("utf8").trimEnd();
          if (text) console.error("[pty-host stderr]", text);
        },
      })
    ).catch(() => {});

    // Wait for the child to be alive enough to accept stdin.
    await Bun.sleep(200);
  }

  private onChunk(chunk: Uint8Array) {
    this.buffer += Buffer.from(chunk).toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const msg: PtyHostMessage = JSON.parse(line);
        this.handle(msg);
      } catch {
        /* skip malformed line */
      }
    }
  }

  private handle(msg: PtyHostMessage) {
    this.emit(msg.type, msg);
  }

  private send(msg: unknown): void {
    if (!this.child) return;
    this.child.stdin?.write(JSON.stringify(msg) + "\n");
  }

  create(id: string, options: Record<string, unknown>): void {
    this.send({ id, type: "create", options });
  }
  write(id: string, data: string): void {
    this.send({ id, type: "write", data });
  }
  resize(id: string, cols: number, rows: number): void {
    this.send({ id, type: "resize", cols, rows });
  }
  kill(id: string, signal?: string): void {
    this.send({ id, type: "kill", signal });
  }
  requestBuffer(id: string): void {
    this.send({ id, type: "buffer" });
  }
  requestSnapshot(id: string): void {
    this.send({ id, type: "snapshot" });
  }

  close(): void {
    this.child?.kill();
    this.child = null;
  }
}

export const ptyHost = new PtyHostClient();
