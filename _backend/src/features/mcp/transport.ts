import type { JsonRpcRequest, JsonRpcResponse, McpServerConfig } from "./types";

export interface McpTransport {
  connect(): Promise<void>;
  send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse>;
  disconnect(): Promise<void>;
}

export function createTransport(server: McpServerConfig): McpTransport {
  if (server.transport === "stdio") {
    return new StdioTransport(server);
  }
  if (server.transport === "tcp") {
    return new TcpTransport(server);
  }
  return new HttpTransport(server);
}

class StdioTransport implements McpTransport {
  private proc: import("bun").Subprocess | null = null;
  private pending = new Map<
    string | number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timer: Timer }
  >();
  private buffer = "";
  private closed = false;

  constructor(private config: McpServerConfig) {}

  async connect(): Promise<void> {
    const cmd = this.config.command;
    if (!cmd) throw new Error("stdio transport requires a command");

    this.proc = Bun.spawn({
      cmd: [cmd, ...(this.config.args ?? [])],
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.closed = false;

    this.proc.stdout?.pipeTo(
      new WritableStream({
        write: (chunk) => this.onData(chunk),
      })
    );

    this.proc.stderr?.pipeTo(
      new WritableStream({
        write: (chunk) => {
          const text = new TextDecoder().decode(chunk).trim();
          if (text) console.debug(`[mcp:${this.config.name} stderr]`, text);
        },
      })
    );

    const exited = this.proc.exited;
    exited.then((code) => {
      this.closed = true;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`MCP server exited with code ${code}`));
        this.pending.delete(id);
      }
    });
  }

  async send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (!this.proc || this.closed) throw new Error("MCP server not connected");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request timed out: ${request.method}`));
      }, 30_000);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new Error("Request aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(request.id, {
        resolve: (v) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
        timer,
      });

      const line = JSON.stringify(request) + "\n";
      const written = this.proc!.stdin!.write(line);
      if (!written) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Failed to write to MCP server stdin"));
      }
    });
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("MCP server disconnected"));
      this.pending.delete(id);
    }
    if (this.proc) {
      this.proc.kill(9);
      this.proc = null;
    }
  }

  private onData(chunk: Uint8Array): void {
    this.buffer += new TextDecoder().decode(chunk);
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg);
            }
          }
        }
      } catch {
        // ignore malformed JSON lines
      }
    }
  }
}

class HttpTransport implements McpTransport {
  constructor(private config: McpServerConfig) {}

  async connect(): Promise<void> {
    if (!this.config.url) throw new Error("http transport requires a url");
  }

  async send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    const url = this.config.url;
    if (!url) throw new Error("http transport requires a url");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.config.headers ?? {}),
    };

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => ac.abort(), 30_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: request.jsonrpc,
          id: request.id,
          method: request.method,
          params: request.params,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} from ${url}${errBody ? `: ${errBody.slice(0, 300)}` : ""}`);
      }

      const body = await res.text();
      const parsed = tryParseJsonRpc(body);
      if (parsed) return parsed;

      throw new Error(`Invalid JSON-RPC response from ${url}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async disconnect(): Promise<void> {
    // no-op for HTTP
  }
}

class TcpTransport implements McpTransport {
  private socket: import("bun").TCPSocket | null = null;
  private pending = new Map<
    string | number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timer: Timer }
  >();
  private buffer = "";
  private closed = false;

  constructor(private config: McpServerConfig) {}

  async connect(): Promise<void> {
    const addr = this.config.url || "127.0.0.1:9876";
    const [host, portStr] = addr.split(":");
    const port = parseInt(portStr, 10);
    if (!host || isNaN(port)) throw new Error(`tcp transport requires host:port, got "${addr}"`);

    this.socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data: (_, data) => this.onData(data),
        error: (_, err) => {
          console.error(`[mcp:${this.config.name} tcp error]`, err);
          this.closed = true;
        },
        end: () => {
          this.closed = true;
          for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error("MCP TCP server closed connection"));
            this.pending.delete(id);
          }
        },
        drain: () => {},
      },
    });
  }

  async send(request: JsonRpcRequest, signal?: AbortSignal): Promise<JsonRpcResponse> {
    if (!this.socket || this.closed) throw new Error("MCP TCP server not connected");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`MCP request timed out: ${request.method}`));
      }, 30_000);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new Error("Request aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(request.id, {
        resolve: (v) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
        timer,
      });

      const line = JSON.stringify(request) + "\n";
      const written = this.socket.write(line);
      if (!written) {
        clearTimeout(timer);
        this.pending.delete(request.id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Failed to write to MCP TCP server"));
      }
    });
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("MCP server disconnected"));
      this.pending.delete(id);
    }
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  private onData(data: Buffer): void {
    this.buffer += new TextDecoder().decode(data);
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id !== undefined && msg.id !== null) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg);
            }
          }
        }
      } catch {
        // ignore malformed JSON lines
      }
    }
  }
}

function tryParseJsonRpc(body: string): JsonRpcResponse | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const hit = tryParseJsonRpc(line.slice(6));
      if (hit) return hit;
    }
    return null;
  }
  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    return null;
  }
}
