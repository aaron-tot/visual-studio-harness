/** PTY client (Bun side): spawns the Node.js PTY host and communicates over
 *  stdio JSON-lines. node-pty must run under Node (Bun ABI is incompatible), so
 *  this process is a `node` child whose stdin/stdout carry framed messages.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

interface PtyHostMessage {
  id: string;
  type: "created" | "data" | "exit" | "error" | "buffer";
  pid?: number;
  data?: string;
  exitCode?: number;
  signal?: number | null;
  message?: string;
}

function findNode(): string {
  const fromEnv = process.env.NODE_BIN;
  if (fromEnv) return fromEnv;
  for (const name of ["node", "nodejs"]) {
    const p = Bun.which(name);
    if (p) return p;
  }
  const nvm = process.env.HOME
    ? `${process.env.HOME}/.nvm/versions/node`
    : null;
  if (nvm) {
    const ls = Bun.spawnSync(["ls", nvm], { stdout: "pipe" }).stdout?.toString() ?? "";
    for (const v of ls.split("\n").map((s) => s.trim()).filter(Boolean).sort().reverse()) {
      const bin = join(nvm, v, "bin", "node");
      try {
        const probe = Bun.spawnSync([bin, "--version"], { stdout: "pipe" });
        if (probe.exitCode === 0) return bin;
      } catch {
        /* not a valid node */
      }
    }
  }
  throw new Error("shared-shell: could not locate a node binary (set NODE_BIN)");
}

/** Absolute path to the PTY host CommonJS script. */
function hostPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "pty-host.cjs");
}

class PtyHostClient extends EventEmitter {
  private child: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private buffer = "";

  async connect(): Promise<void> {
    if (this.child) return;
    const proc = Bun.spawn([findNode(), hostPath()], {
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

  close(): void {
    this.child?.kill();
    this.child = null;
  }
}

export const ptyHost = new PtyHostClient();
