import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

const execFileP = promisify(execFile);

type OpenUrlPayload = { url: string };
type OpenPathPayload = { path: string; action?: "open" | "open-parent"; workspaceRoot?: string };

export function registerOpenUrlRoutes(app: FastifyInstance) {
  // Legacy endpoint — kept for backward compatibility
  app.post<{ Body: OpenUrlPayload }>(
    "/api/open-url",
    async (request, reply) => {
      const { url } = request.body;

      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return reply.code(400).send({ error: "url is required" });
      }

      const trimmed = url.trim();

      try {
        if (/^https?:\/\//i.test(trimmed) || /^ftp:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) {
          const target = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
          await openTarget(target);
          return { status: "ok", opened: "url" };
        }

        // File/folder path — resolve relative to workspace if provided
        const resolved = resolvePath(trimmed);
        if (existsSync(resolved)) {
          await openTarget(resolved);
          return { status: "ok", opened: "path" };
        }
        const parent = dirname(resolved);
        if (existsSync(parent)) {
          await openTarget(parent);
          return { status: "ok", opened: "parent-dir" };
        }
        return reply.code(404).send({ error: "path not found", target: resolved });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: "failed to open", detail: message });
      }
    }
  );

  // New endpoint — handles file/folder paths with workspace resolution
  app.post<{ Body: OpenPathPayload }>(
    "/api/open-path",
    async (request, reply) => {
      const { path: rawPath, action = "open", workspaceRoot } = request.body;

      if (!rawPath || typeof rawPath !== "string" || rawPath.trim().length === 0) {
        return reply.code(400).send({ error: "path is required" });
      }

      const trimmed = rawPath.trim();
      const resolved = resolvePath(trimmed, workspaceRoot);

      try {
        if (action === "open-parent") {
          const target = dirname(resolved);
          if (!existsSync(target)) {
            return reply.code(404).send({ error: "parent directory not found", target });
          }
          await openTarget(target);
          return { status: "ok", opened: "parent-dir", path: resolved };
        }

        // action === "open"
        if (!existsSync(resolved)) {
          // Try parent as fallback
          const parent = dirname(resolved);
          if (existsSync(parent)) {
            await openTarget(parent);
            return { status: "ok", opened: "parent-dir", path: resolved };
          }
          return reply.code(404).send({ error: "path not found", path: resolved });
        }

        await openTarget(resolved);
        return { status: "ok", opened: "path", path: resolved };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: "failed to open", detail: message });
      }
    }
  );
}

/** Resolve a path — if relative, join with workspaceRoot or fall back to CWD */
function resolvePath(p: string, workspaceRoot?: string): string {
  if (isAbsolute(p)) return resolve(p);
  if (workspaceRoot) return resolve(workspaceRoot, p);
  return resolve(p);
}

async function openTarget(target: string): Promise<void> {
  const platform = process.platform;
  if (platform === "linux") {
    await execFileP("xdg-open", [target]);
  } else if (platform === "darwin") {
    await execFileP("open", [target]);
  } else {
    await execFileP("cmd", ["/c", "start", "", target]);
  }
}

