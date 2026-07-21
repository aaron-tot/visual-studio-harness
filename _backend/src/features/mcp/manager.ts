import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../tools/types";
import type { McpServerConfig, McpConnectionStatus } from "./types";
import { McpClient } from "./client";
import { jsonSchemaToZod } from "./schema-util";

const ENV_VAR_RE = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

function resolveEnvVars(value: string): string | null {
  if (!value.includes("{env:")) return value;
  const resolved = value.replace(ENV_VAR_RE, (_match, name: string) => {
    return process.env[name] ?? _match;
  });
  if (resolved.includes("{env:")) return null;
  return resolved;
}

function resolveConfig<T>(obj: T): T | null {
  if (typeof obj === "string") {
    return resolveEnvVars(obj) as T;
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = Array.isArray(obj) ? [] : {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string") {
        const resolved = resolveEnvVars(val);
        if (resolved === null) return null;
        result[key] = resolved;
      } else if (val && typeof val === "object") {
        const nested = resolveConfig(val);
        if (nested === null) return null;
        result[key] = nested;
      } else {
        result[key] = val;
      }
    }
    return result as T;
  }
  return obj;
}

interface ManagedServer {
  config: McpServerConfig;
  client: McpClient;
  toolDefs: ToolDef[];
}

export class McpManager {
  private servers = new Map<string, ManagedServer>();

  async init(config: { mcpServers?: McpServerConfig[] }): Promise<void> {
    await this.reconfigure(config);
  }

  async reconfigure(config: { mcpServers?: McpServerConfig[] }): Promise<void> {
    const incoming = config.mcpServers ?? [];
    const incomingMap = new Map(incoming.map((s) => [s.name, s]));

    for (const [name, existing] of this.servers) {
      if (!incomingMap.has(name)) {
        await existing.client.disconnect();
        this.servers.delete(name);
      }
    }

    for (const raw of incoming) {
      const resolved = resolveConfig(raw);
      if (!resolved) {
        console.warn(`[mcp] Skipping ${raw.name}: set the required env var(s) to enable`);
        continue;
      }

      const server = resolved;
      const existing = this.servers.get(server.name);
      if (existing && !hasConfigChanged(existing.config, server)) continue;

      if (existing) {
        await existing.client.disconnect();
      }

      if (!server.enabled ?? true) continue;

      const client = new McpClient(server);
      const managed: ManagedServer = { config: server, client, toolDefs: [] };

      try {
        await client.connect();
        managed.toolDefs = client.tools.map((tool) =>
          this.toToolDef(server, tool, client)
        );
      } catch (err) {
        console.error(`[mcp] Failed to connect ${server.name}:`, err);
      }

      this.servers.set(server.name, managed);
    }
  }

  getTools(): ToolDef[] {
    const all: ToolDef[] = [];
    for (const [, managed] of this.servers) {
      all.push(...managed.toolDefs);
    }
    return all;
  }

  getStatus(): McpConnectionStatus[] {
    const out: McpConnectionStatus[] = [];
    for (const [, managed] of this.servers) {
      const client = managed.client;
      out.push({
        name: managed.config.name,
        transport: managed.config.transport,
        connected: client.connected,
        toolCount: client.tools.length,
      });
    }
    return out;
  }

  async testConnection(
    server: McpServerConfig
  ): Promise<{ ok: boolean; error?: string; toolCount?: number; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }> {
    const client = new McpClient(server);
    try {
      await client.connect();
      const tools = client.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
      await client.disconnect();
      return { ok: true, toolCount: tools.length, tools };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async callTool(
    server: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; result?: string; error?: string }> {
    const client = new McpClient(server);
    try {
      await client.connect();
      const result = await client.callTool(toolName, args);
      await client.disconnect();
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private toToolDef(
    server: McpServerConfig,
    tool: { name: string; description?: string; inputSchema?: Record<string, unknown> },
    client: McpClient
  ): ToolDef {
    const prefixedName = `${server.name}_${tool.name}`;
    const schema = tool.inputSchema
      ? jsonSchemaToZod(tool.inputSchema as Record<string, unknown>)
      : z.object({}).passthrough();

    return {
      name: prefixedName,
      description: tool.description || `MCP tool from ${server.name}`,
      inputSchema: schema as z.ZodTypeAny,
      permissionDefault: "allow",
      execute: async (args: unknown, ctx: BaseToolContext): Promise<ToolResult> => {
        try {
          const result = await client.callTool(
            tool.name,
            (args as Record<string, unknown>) ?? {},
            ctx.abortSignal
          );
          return {
            title: prefixedName,
            output: result || "Tool returned no output",
          };
        } catch (err) {
          return {
            title: prefixedName,
            output: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      },
    };
  }
}

let instance: McpManager | null = null;

export function getMcpManager(): McpManager {
  if (!instance) {
    instance = new McpManager();
  }
  return instance;
}

export function setMcpManager(mgr: McpManager): void {
  instance = mgr;
}

function hasConfigChanged(a: McpServerConfig, b: McpServerConfig): boolean {
  return (
    a.transport !== b.transport ||
    a.command !== b.command ||
    a.url !== b.url ||
    a.enabled !== b.enabled ||
    JSON.stringify(a.args) !== JSON.stringify(b.args) ||
    JSON.stringify(a.env) !== JSON.stringify(b.env) ||
    JSON.stringify(a.headers) !== JSON.stringify(b.headers)
  );
}
