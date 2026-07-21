#!/usr/bin/env bash
# File watcher that restarts the backend when any .ts file changes.
# Avoids bun --watch's built-in [N lines elided] dedup.
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WATCH_DIR="$SCRIPT_DIR/backend/src"
STAMP="$SCRIPT_DIR/backend/.watch-stamp"

touch "$STAMP"

while true; do
  MODE=dev bun run "$SCRIPT_DIR/backend/src/index.ts" &
  PID=$!
  # Poll for file changes every 2s
  while sleep 2; do
    if ! kill -0 "$PID" 2>/dev/null; then
      # Process died (compile error, etc) — restart outer loop
      break
    fi
    if find "$WATCH_DIR" -name '*.ts' -newer "$STAMP" 2>/dev/null | head -1 | grep -q .; then
      touch "$STAMP"
      kill "$PID" 2>/dev/null
      # Wait up to 3s for graceful shutdown, then force-kill
      for _ in 1 2 3; do
        if ! kill -0 "$PID" 2>/dev/null; then break; fi
        sleep 1
      done
      kill -9 "$PID" 2>/dev/null || true
      wait "$PID" 2>/dev/null || true
      break
    fi
  done
done
