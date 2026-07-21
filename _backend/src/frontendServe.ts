import type { FastifyInstance } from "fastify";
import { FRONTEND_ASSETS } from "./generated/frontend-assets";

const cache = new Map<string, Buffer>();

function decode(path: string): Buffer | null {
  const asset = FRONTEND_ASSETS[path];
  if (!asset) return null;
  let buf = cache.get(path);
  if (!buf) {
    buf = Buffer.from(asset.base64, "base64");
    cache.set(path, buf);
  }
  return buf;
}

function normalizeUrlPath(url: string): string {
  let path = url.split("?")[0] || "/";
  if (!path.startsWith("/")) path = "/" + path;
  if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") return "/index.html";
  return path;
}

export function hasEmbeddedFrontend(): boolean {
  return Object.keys(FRONTEND_ASSETS).length > 0;
}

export function registerEmbeddedFrontend(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    // Let API/WS 404s stay as 404
    if (req.url.startsWith("/api") || req.url.startsWith("/chat")) {
      return reply.code(404).send({ error: "Not found" });
    }

    const path = normalizeUrlPath(req.url);
    const exact = decode(path);
    if (exact) {
      const mime = FRONTEND_ASSETS[path]!.mime;
      return reply.type(mime).send(exact);
    }

    // SPA fallback
    const index = decode("/index.html");
    if (index) {
      return reply.type("text/html").send(index);
    }

    return reply.code(404).send("Frontend not embedded. Run bun run prod to build.");
  });

  console.log(`Serving embedded frontend (${Object.keys(FRONTEND_ASSETS).length} files)`);
}
