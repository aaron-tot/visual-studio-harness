/** Shared-shell REST routes: create/list/write/close shell, per session. */
import type { FastifyInstance } from "fastify";
import {
  createShell,
  listShells,
  writeToShell,
  resizeShell,
  closeShell,
  getShellOutput,
  setShellSnapshot,
  getShellSnapshot,
  closeAllShellsForSession,
} from "./manager";

export function registerSharedShellRoutes(app: FastifyInstance): void {
  app.post("/api/shared-shell/create", async (request) => {
    const body = request.body as { sessionId?: string; name?: string; cwd?: string } | null;
    const sessionId = body?.sessionId;
    if (!sessionId?.trim()) {
      return { error: "sessionId is required" };
    }
    try {
      const shell = await createShell({ sessionId, name: body?.name, cwd: body?.cwd });
      return { ok: true, shell };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/shared-shell/:sessionId", async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return { shells: listShells(sessionId) };
  });

  app.post("/api/shared-shell/write", async (req) => {
    const body = req.body as { id?: string; data?: string } | undefined;
    const id = body?.id;
    const data = body?.data;
    if (!id || typeof data !== "string") {
      return { error: "id and data are required" };
    }
    try {
      writeToShell(id, data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/shared-shell/resize", async (req) => {
    const body = req.body as { id?: string; cols?: number; rows?: number } | undefined;
    const { id, cols, rows } = body ?? {};
    if (!id || typeof cols !== "number" || typeof rows !== "number") {
      return { error: "id, cols, and rows are required" };
    }
    try {
      resizeShell(id, cols, rows);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/shared-shell/output", async (req) => {
    const body = req.body as { id?: string } | undefined;
    const id = body?.id;
    if (!id) {
      return { error: "id is required" };
    }
    return { output: await getShellOutput(id) };
  });

  // Persist a shell's rendered xterm snapshot so a later frontend refresh can
  // restore the exact coloured view (not a fragile raw-buffer replay).
  app.post("/api/shared-shell/snapshot", async (req) => {
    const body = req.body as
      | { id?: string; cols?: number; rows?: number; serialized?: string }
      | undefined;
    const { id, cols, rows, serialized } = body ?? {};
    if (!id) {
      return { error: "id is required" };
    }
    try {
      setShellSnapshot(id, {
        cols: Number(cols),
        rows: Number(rows),
        serialized: typeof serialized === "string" ? serialized : "",
        updatedAt: Date.now(),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/shared-shell/snapshot/get", async (req) => {
    const body = req.body as { id?: string } | undefined;
    const id = body?.id;
    if (!id) {
      return { error: "id is required" };
    }
    return { snapshot: getShellSnapshot(id) };
  });

  app.post("/api/shared-shell/close", async (req) => {
    const body = req.body as { id?: string } | undefined;
    const id = body?.id;
    if (!id) return { error: "id is required" };
    closeShell(id);
    return { ok: true };
  });

  app.delete("/api/shared-shell/session/:sessionId", async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    closeAllShellsForSession(sessionId);
    return { ok: true };
  });
}
