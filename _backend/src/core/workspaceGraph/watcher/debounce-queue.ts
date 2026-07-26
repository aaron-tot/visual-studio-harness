import type { WorkspaceFsEvent } from "./events";

export interface DebounceQueue {
  push(event: WorkspaceFsEvent): void;
  flush(): void;
  close(): void;
}

export function createDebounceQueue(
  debounceMs: number,
  onFlush: (events: WorkspaceFsEvent[]) => Promise<void>
): DebounceQueue {
  let buffer: WorkspaceFsEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function scheduleFlush() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed && buffer.length > 0) {
        const batch = buffer;
        buffer = [];
        onFlush(batch).catch((err) => {
          console.error("[workspace-graph] watcher batch error:", err);
        });
      }
    }, debounceMs);
  }

  return {
    push(event) {
      if (closed) return;
      buffer.push(event);
      scheduleFlush();
    },

    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (buffer.length > 0) {
        const batch = buffer;
        buffer = [];
        onFlush(batch).catch((err) => {
          console.error("[workspace-graph] watcher flush error:", err);
        });
      }
    },

    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      buffer = [];
    },
  };
}