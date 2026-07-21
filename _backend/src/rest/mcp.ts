import type { FastifyInstance } from "fastify";
import type { McpServerConfig } from "../../_shared/types";
import { getMcpManager } from "../features/mcp";

export function registerMcpRoutes(app: FastifyInstance) {
  app.get("/api/mcp-servers/status", async () => {
    const manager = getMcpManager();
    return { servers: manager.getStatus() };
  });

  app.post("/api/mcp-servers/test", async (request, reply) => {
    const body = request.body as McpServerConfig;
    if (!body || !body.name || !body.transport) {
      return reply.code(400).send({ error: "Server name and transport type required" });
    }
    if (body.transport === "stdio" && !body.command) {
      return reply.code(400).send({ error: "stdio transport requires a command" });
    }
    if ((body.transport === "http" || body.transport === "tcp") && !body.url) {
      return reply.code(400).send({ error: `${body.transport} transport requires a url` });
    }
    const manager = getMcpManager();
    const result = await manager.testConnection(body);
    return result;
  });

  app.post("/api/mcp-servers/call-tool", async (request, reply) => {
    const { server, toolName, args } = request.body as {
      server: McpServerConfig;
      toolName: string;
      args: Record<string, unknown>;
    };
    if (!server || !toolName) {
      return reply.code(400).send({ error: "Server config and tool name required" });
    }
    const manager = getMcpManager();
    const result = await manager.callTool(server, toolName, args ?? {});
    return result;
  });
}
