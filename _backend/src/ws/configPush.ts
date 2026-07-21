import type { WebSocket } from "ws";

const connections = new Set<WebSocket>();

export function registerConnection(socket: WebSocket) {
  connections.add(socket);
  socket.on("close", () => connections.delete(socket));
}

export function broadcastConfig(config: import("../../../_shared/types").ConfigFile) {
  const msg = JSON.stringify({ type: "config_updated", config });
  for (const socket of connections) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(msg);
      } catch {
        // Socket may fail (e.g. kernel buffer full); skip and continue.
      }
    }
  }
}

/** Broadcast an arbitrary payload to every connected client (not session-scoped). */
export function broadcastToAll(payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const socket of connections) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(msg);
      } catch {
        // Socket may fail (e.g. kernel buffer full); skip and continue.
      }
    }
  }
}
