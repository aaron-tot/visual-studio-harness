type MessageHandler = (data: unknown) => void;
type CloseHandler = () => void;
type OpenHandler = () => void;

import { chatDebug } from "../features/chat/debug";

/** Streaming/session events worth tracing when debugging a stuck "Thinking". */
const TRACED_WS_TYPES = new Set([
  "token",
  "reasoning",
  "done",
  "error",
  "tool_start",
  "tool_update",
  "tool_end",
  "session_state",
  "session_created",
  "session_stream_start",
  "session_stream_end",
]);

class WsClient {
  ws: WebSocket | null = null;
  private handlers = new Map<string, MessageHandler[]>();
  private closeHandlers: CloseHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Messages queued while WebSocket was not yet open, flushed on connect. */
  private pendingMessages: string[] = [];
  /** True after at least one successful open (so reconnect can rehydrate). */
  hadOpen = false;

  constructor() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const port = import.meta.env.DEV ? 3001 : window.location.port;
    this.url = `${protocol}//${window.location.hostname}:${port}/chat`;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    this.cleanup();
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      const isReconnect = this.hadOpen;
      this.hadOpen = true;
      // Flush any messages queued while the socket was connecting.
      const pending = this.pendingMessages;
      this.pendingMessages = [];
      for (const msg of pending) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg);
      }
      for (const h of this.openHandlers) h();
      if (isReconnect) {
        const reconHandlers = this.handlers.get("__reconnect__");
        if (reconHandlers) {
          for (const h of reconHandlers) h({ type: "__reconnect__" });
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type as string;
        const typeHandlers = this.handlers.get(type);
        if (TRACED_WS_TYPES.has(type)) {
          chatDebug("ws", `recv ${type}`, {
            sessionId: msg.sessionId,
            seq: msg.seq,
            turnId: msg.turnId,
            handlers: typeHandlers?.length ?? 0,
          });
        } else if (!typeHandlers || typeHandlers.length === 0) {
          chatDebug("ws", `recv ${type} (no handler)`, { sessionId: msg.sessionId });
        }
        if (typeHandlers) {
          for (const h of typeHandlers) h(msg);
        }
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onclose = () => {
      for (const h of this.closeHandlers) h();
      if (this.ws) {
        this.ws = null;
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      for (const h of this.closeHandlers) h();
      this.cleanup();
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  private cleanup() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  disconnect() {
    this.cleanup();
  }

  send(data: unknown) {
    const msg = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
      return true;
    }
    // WebSocket not yet open — queue for delivery once connected.
    this.pendingMessages.push(msg);
    return true;
  }

  on(type: string, handler: MessageHandler) {
    const existing = this.handlers.get(type) || [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }

  off(type: string, handler: MessageHandler) {
    const existing = this.handlers.get(type) || [];
    this.handlers.set(
      type,
      existing.filter((h) => h !== handler)
    );
  }

  onDisconnect(handler: CloseHandler) {
    this.closeHandlers.push(handler);
  }

  offDisconnect(handler: CloseHandler) {
    this.closeHandlers = this.closeHandlers.filter((h) => h !== handler);
  }

  onOpen(handler: OpenHandler) {
    this.openHandlers.push(handler);
  }

  /** Fires after a successful reconnect (not the first connect). */
  onReconnect(handler: MessageHandler) {
    this.on("__reconnect__", handler);
  }
}

export const wsClient = new WsClient();
