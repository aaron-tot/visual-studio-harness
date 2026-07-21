import type { FastifyInstance } from "fastify";
import type { ConfigFile } from "../../../_shared/types";
import { runTurn } from "../agent/turn";

/**
 * Blocking JSON chat for tests / automation.
 * UI continues to use WebSocket streaming.
 * Provider/model always come from config.agents (not request body).
 *
 * POST /api/messages
 * {
 *   content: string,
 *   sessionId?: string,       // omit or "new" to create
 *   workspaceRoot?: string,   // required effectively for new sessions (or default)
 * }
 */
export function registerMessageRoutes(
  app: FastifyInstance,
  dataDir: string,
  getConfig: () => ConfigFile
) {
  app.post("/api/messages", async (request, reply) => {
    const body = (request.body || {}) as {
      content?: string;
      sessionId?: string;
      workspaceRoot?: string;
    };

    if (!body.content?.trim()) {
      return reply.code(400).send({ error: "content is required" });
    }

    try {
      const result = await runTurn(
        dataDir,
        getConfig(),
        {
          content: body.content,
          sessionId: body.sessionId,
          workspaceRoot: body.workspaceRoot,
        },
        {
          source: "rest",
          // No UI: auto-approve tools that would ask
          askPermission: async () => true,
        }
      );

      const status = result.error ? 502 : 200;
      return reply.code(status).send({
        sessionId: result.sessionId,
        created: result.created,
        meta: result.meta,
        workspaceRoot: result.workspaceRoot,
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        error: result.error ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        message === "Session not found"
          ? 404
          : message.includes("required") || message.includes("not found") || message.includes("workspace")
            ? 400
            : 500;
      return reply.code(code).send({ error: message });
    }
  });
}
