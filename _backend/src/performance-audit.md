# Performance & Memory Audit

Generated: 2026-07-29T22:40Z
Scope: Full-stack (Bun backend + Svelte/Solid frontend, SQLite via Drizzle ORM)

## Key

| Severity | Meaning |
|----------|---------|
| 🔴 Critical | Causes noticeable lag, wasted memory per turn, or user-facing stutter |
| 🟡 Medium | Accumulates over time, affects large sessions or many users |
| 🔵 Low | Minor; optimize after critical issues are resolved |

---

## 1. Performance Issues

### 🔴 P1 — Per-token SQLite writes in stream hot loop

**Files:**
- `_backend/src/features/chat/persist-stream.ts:17-28` — `writeDelta`
- `_backend/src/features/chat/stream-llm.ts:219` — `onToken` → `stepWriter.writeDelta`
- `_backend/src/features/chat/stream-llm.ts:225` — `onReasoning` → `stepWriter.writeDelta`

**Problem:** Every single token from the LLM triggers a SQLite `UPDATE` or `INSERT` via `updateStepPartData` / `insertStepPart`. For a 5000-token response, that's 5000+ synchronous SQLite round-trips on the hot path. The `onToken` handler is invoked synchronously in the SDK stream `for await...of` loop.

**Root cause:** The `writeDelta` method coalesces consecutive text deltas of the same type, but only within the same synchronous microtask — each `setTimeout` / `nextTick` creates a new delta. With fast LLM output, each chunk arrives in its own microtask, creating one DB write per token.

**Impact:** Adds ~0.1-0.5ms per token in SQLite overhead. For 5000 tokens, that's 500-2500ms of unnecessary wall-clock time. The user sees slower streaming.

**Fix:**
- Batch adjacent deltas into a single `updateStepPartData` call using a debounce timer (e.g. 50ms flush window)
- Or accumulate deltas in memory and flush only when switching to a new part type (tool/reasoning step)
- Or use SQLite WAL-mode transactions: wrap a batch of writes in `BEGIN`/`COMMIT`

---

### 🔴 P2 — Raw response body duplication via TransformStream

**File:** `_backend/src/features/chat/raw-capture-fetch.ts:31-83`

**Problem:** Every LLM streaming response is piped through a `TransformStream` that buffers the entire body in memory (up to 10MB). After streaming completes, `parseCapturedBody` does a full O(n) walk of all SSE lines via `rawText.split("\n")`.

**Impact:**
- Double memory allocation per response (the stream chunks array + the final `rawResponse` JSON parse)
- 10MB per-turn cap means a single long agent session with many tool calls can accumulate multiple 10MB buffers
- The SSE parsing is purely for debugging/display — never critical path

**Fix:**
- Reduce `MAX_CAPTURE_SIZE_BYTES` to 500KB or make it configurable
- Or make raw capture opt-in via config flag instead of always-on
- Or use a streaming SSE parser that builds the response incrementally instead of post-processing

---

### 🔴 P3 — N+1 DB queries in session state hydration

**File:** `_backend/src/features/chat/project-chat.ts:13-97`

**Problem:** `projectSessionChat` does:
1. One `SELECT * FROM turns WHERE sessionId = ? ORDER BY turnNumber` (all turns)
2. Then for each turn, one `SELECT * FROM stepParts WHERE turnId = ? ORDER BY seq` (one query per turn)

For a session with 20 turns, that's 21 queries. Each query involves SQLite B-tree traversal.

**Called from:** `view-tracker.ts:59` — every `request_session_state` (session switch, reconnect, initial load)

**Impact:** On session switch to a session with many turns, the user waits for N+1 sequential queries. With 20+ turns and 50+ parts per turn, this is dozens of queries.

**Fix:**
- Single JOIN: `SELECT * FROM turns LEFT JOIN stepParts ON stepParts.turnId = turns.id WHERE sessionId = ? ORDER BY turnNumber, stepParts.seq`
- Or use Drizzle relations with `with` clause for eager loading
- Or batch with `WHERE turnId IN (id1, id2, ...)` in a single query

---

### 🔴 P4 — Full array copy & re-render on every token (Frontend)

**Files:**
- `_frontend/src/features/chat/store.ts:221-240` — `appendToken`
- `_frontend/src/components/chat/MessageList.tsx:21-22` — subscribes to 10+ store fields
- `_frontend/src/features/chat/ws-handlers.ts:19-31` — `token` handler

**Problem:** Every incoming WS `token` event triggers:
1. `appendToken` → spreads `streamingParts` array + spreads `messages` array + creates new objects for the last assistant message
2. This triggers Zustand `set()` which notifies all subscribers
3. `MessageList` re-renders because `messages`, `streamingParts`, and `streamingContent` all changed references
4. `MessageRow` re-renders because its message prop is a new object
5. `MessagePart` trees re-render

For 5000 tokens, that's 5000 full tree re-renders. Each re-render calls `sortParts(streamingParts)` on the full (growing) parts array — `useMemo` does help, but the sort is still O(n log n) and runs on every token event.

**Impact:** Visible UI stutter during fast streaming, especially on large screens rendering many parts/tools.

**Fix:**
- Use a virtualized list (only render visible rows)
- Use memo selectors: split subscriptions into fine-grained selectors so `MessageList` doesn't re-render on every micro-change
- Use `useSyncExternalStore` with event-based subscriptions instead of polling full state
- Debounce React renders: batch multiple tokens into a single render frame using `requestAnimationFrame` or `Scheduler.yield`

---

### 🔴 P5 — Dynamic `import()` in every WS event handler

**Files:**
- `_frontend/src/features/chat/ws-handlers.ts:227, 318, 323-324, 339, 363-364`

**Problem:** Five different WS event handlers (`session_created`, `session_updated`, `session_stream_start`, `session_stream_end`, `onDisconnect`) use `import("../../stores/sessions")` to access `useSessionStore`. This creates a new promise resolution chain on EVERY event.

**Impact:** Each `import()` is syntactically cached (returns the same module), but still adds microtask overhead and GC pressure. For `session_stream_start`+`session_stream_end` firing per-turn, this is ~4 dynamic imports per turn minimum.

**Fix:** Import `useSessionStore` at module top level. The barrel shim already exports it from `../../stores/sessions`.

---

### 🟡 P6 — `broadcast()` iterates ALL WebSocket connections

**File:** `_backend/src/transports/ws.ts:21-29`

**Problem:** `broadcast()` iterates the entire `connections` Set (which can include 50+ sockets from different users/sessions). The function is called on every `session_update` (config change).

**Impact:** O(n) iteration over all connections to deliver a message relevant to only 1 session. For N connected clients, each config update sends N-1 messages to uninterested sockets.

**Fix:**
- Use `sendToSession()` instead of `broadcast()` for session-scoped updates
- Or maintain a session→sockets map and only send to interested sockets

---

### 🟡 P7 — `projectStreamingContent` re-reads from DB on every session state request

**Files:**
- `_backend/src/features/chat/project-chat.ts:99+` — `projectStreamingContent`
- `_backend/src/features/sessions/view-tracker.ts:61` — called in `buildSessionStatePayload`

**Problem:** Every `request_session_state` (session switch, reconnect) re-reads all streaming content from the database by querying all step parts for the active turn. For a turn with 200+ parts (text + reasoning + tools), this is a full scan.

**Impact:** Session switches during active streaming cause an extra DB read of potentially hundreds of rows.

**Fix:** Cache the streaming content in memory for the active turn, invalidate on completion.

---

### 🟡 P8 — `getNextTurnNumber` does `SELECT MAX` per turn

**File:** `_backend/src/features/chat/db-trace.ts:21-30`

**Problem:** `getNextTurnNumber` runs `SELECT MAX(turnNumber) FROM turns WHERE sessionId = ?` on every single turn. SQLite's MAX over an indexed column is fast, but still an index scan.

**Impact:** One extra query per user turn on the startup path. For rapid auto-continue turns, the cost multiplies.

**Fix:** Track `nextTurnNumber` in the in-memory session runtime object instead of querying every time.

---

### 🟡 P9 — Snapshot dedup re-parses JSON

**File:** `_backend/src/features/chat/db-trace.ts:155-178`

**Problem:** `ensureToolsSnapshot` calls:
1. `JSON.stringify(JSON.parse(toolsJson), ...)` — parse + re-stringify with sorted keys (allocates full AST)
2. Creates a sorted `toolNamesJson` array
3. Stores the full JSON in DB

For large tool registries (20+ tools with complex schemas), this creates significant temporary allocations on every turn.

**Impact:** GC pressure. Each turn creates ~10-50KB of temporary allocation from the tool schema JSON processing.

**Fix:** Sort keys before `JSON.stringify` at the call site, pass pre-canonicalized JSON. Avoid the parse+re-stringify dance.

---

### 🟡 P10 — `insertTurnContext` validates each context turn individually

**File:** `_backend/src/features/chat/db-trace.ts:69-119`

**Problem:** For each context turn ID, a separate `SELECT` validates the turn exists and belongs to the same session. Batch queries with `WHERE id IN (...)` would be one query instead of N.

**Impact:** Adds N sequential DB reads on the turn startup path.

**Fix:** Single `SELECT * FROM turns WHERE id IN (...)` query, then filter in-memory.

---

### 🔵 P11 — `NewChat.tsx` is 842 lines (monolithic)

**File:** `_frontend/src/components/chat/NewChat.tsx`

Single component handling: chat page layout, settings panels, session creation, agent selection. Violates the established 300-line rule. Causes unnecessary re-renders across unrelated state.

---

## 2. Memory Leaks

### 🔴 L1 — Module-level `pending` Maps mutated during iteration

**Files:**
- `_backend/src/features/tools/permission-wait.ts:39-46` — `cancelPermissionsForSession`
- `_backend/src/features/subagents/config-wait.ts:52-58` — `cancelSubagentConfigRequests`
- `_backend/src/features/tools/agent-change-wait.ts:41-47` — `cancelAgentChangeRequests`

**Problem:** All three functions use `for (const [id, p] of pending)` with `pending.delete(id)` inside the loop body. Iterating a Map while deleting entries is technically undefined behavior per the ECMAScript spec (although in practice, V8 handles it). More critically, `cancelPermissionsForSession` receives a `sessionId` parameter but **ignores it** — it cancels ALL pending permissions, not just the session's.

**Impact:** If session A has a pending permission and session B is cancelled, session A's permission is silently denied. This can cause stale promises that never resolve or resolve incorrectly.

**Fix:**
- Filter by sessionId: maintain a `sessionId → toolCallId[]` index to scope cancellation
- Never delete from a Map while iterating — collect keys first, then delete

---

### 🔴 L2 — Stale entries in global `toolContinueAttempts` / `thinkingContinueAttempts`

**File:** `_backend/src/features/chat/ws-chat.ts:37-38`

**Problem:** Two module-level Maps `toolContinueAttempts` and `thinkingContinueAttempts` are cleaned in the `finally` block at `ws-chat.ts:229-231`, but:
1. Cleanup only happens when `sessionId` is truthy
2. If `runTurn` throws before `onSessionReady` sets `sessionId`, the entries created during auto-continue are never cleaned
3. The Maps are keyed by sessionId but hold `number[]` arrays that grow unboundedly

**Impact:** Over multiple sessions, entries accumulate in these Maps indefinitely. Each entry holds an array of timestamps.

**Fix:** Use WeakMap or ensure cleanup in all early-return/catch paths. Consider TTL-based eviction.

---

### 🟡 L3 — Multiple WebSocket reconnect timers

**File:** `_frontend/src/lib/ws.ts:91-103`

**Problem:** If `onclose` and `onerror` fire in quick succession (within the same microtask), both create `setTimeout(() => this.connect(), 3000)`. The second overwrites `this.reconnectTimer`, but the first timer's closure still holds the OLD `this.ws` reference. This creates two concurrent reconnect attempts.

**Impact:** Two WebSocket connections from the same client, two sessions being hydrated, duplicated state.

**Fix:** Guard the connect call: `if (this.reconnectTimer) return;` before setting a new timer. Or ensure `onclose`/`onerror` are mutually exclusive by cleaning up within the handler.

---

### 🟡 L4 — Raw capture buffer stays alive for turn lifetime

**File:** `_backend/src/features/chat/raw-capture-fetch.ts:31-83`

**Problem:** The `chunks: Uint8Array[]` array accumulates the full streaming response body (up to 10MB). After streaming ends, `rawResponse` holds the parsed JSON. Both references are only freed when `streamChat` returns and the result is consumed.

**Impact:** During a long turn with auto-continue (5+ continuation turns), up to 50MB of raw response data sits in memory simultaneously.

**Fix:** Reduce cap, make configurable, or process incrementally and discard.

---

### 🟡 L5 — HookBus handlers accumulate without cleanup

**File:** `_backend/src/features/hooks/bus.ts:29`

**Problem:** `HookBus.on()` replaces by `id` when the same id is used, but across different feature modules, different ids may register for the same event. No module calls `off()` to clean up. Over the lifetime of the process, the handlers Map grows.

**Impact:** On every `bus.emit()`, extra handlers are called and awaited, even if they belong to now-inactive features.

**Fix:** Require explicit cleanup in feature shutdown, or use a registry that ties handler lifetime to a session/context.

---

### 🟡 L6 — `socketToSession` / `sessionToSockets` stale entries on close-error race

**File:** `_backend/src/features/sessions/view-tracker.ts:32-39`

**Problem:** `clearActiveSession` is called from both the WS `close` and `error` handlers. If both fire, `socketToSession.get(socket)` returns `undefined` on the second call (already deleted), so `sessionToSockets` cleanup is skipped. But this is self-healing since the socket is already gone.

**Minor risk:** The `connections` Set in `transports/ws.ts` and the `socketToSession`/`sessionToSockets` maps are independent. If a socket's close handler throws before calling `clearActiveSession`, the socket stays in `sessionToSockets` forever.

**Fix:** Use a WeakMap keyed by the socket instead of `Map<WebSocket, string>`. When the socket is GC'd, the entry auto-evicts.

---

### 🟡 L7 — MCP child process lifecycle gap

**File:** `_backend/src/features/mcp/transport.ts`

**Problem:** MCP servers are spawned as child processes. On config change, old server processes must be explicitly killed. If the config update path doesn't await `close()` on old servers before spawning new ones, orphaned processes accumulate.

**Impact:** Each MCP server is a Node.js child process — leaking a few per config change adds up.

**Fix:** Ensure MCP manager's `dispose()` or equivalent is called on config hot-reload.

---

### 🔵 L8 — `session-abort.ts` `pendingContinueMap` entries for abandoned sessions

**File:** `_backend/src/features/chat/session-abort.ts:32`

**Problem:** `pendingContinueMap` holds entries for sessions that have swtiched agent with "switch_continue". If the user closes the session without the continue message being consumed, the entry stays.

**Impact:** Each leaked entry is small (one string + one string), but over long-running server usage, accumulates.

**Fix:** TTL-based eviction or cleanup on session delete.

---

### 🔵 L9 — Debug logging in hot path

**Files:**
- `_backend/src/features/chat/stream-llm.ts:164-168` — `DEBUG_STREAM_EVENTS` flag
- `_backend/src/features/chat/project-chat.ts` — `console.log` during chat projection
- `_frontend/src/features/chat/store.ts:150` — `console.log("tmpDebug: store.sendMessage", ...)`
- `_backend/src/features/chat/ws-chat.ts:72` — `console.log("tmpDebug: handleChatMessage ENTERED", ...)`

Several `tmpDebug` and `console.log` statements remain in production code. These are synchronous I/O calls that block the event loop.

---

## 3. Summary

### Top 5 systemic issues to fix first

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | Per-token SQLite writes (P1) | 2 days | 70% of perceived slowness during streaming |
| 2 | Raw body TransformStream + 10MB buffer (P2) | 1 day | Reduces peak memory per turn by 90% |
| 3 | N+1 query in session hydration (P3) | 0.5 day | Fixes slow session switches with 10+ turns |
| 4 | Frontend re-render storm (P4) | 3 days | Biggest UI jank source |
| 5 | Pending Maps with dead entries (L1+L2) | 0.5 day | Eliminates stale promise hangs |

### Quick wins (under 30 minutes each)

- Remove `tmpDebug` log statements (L9)
- Dynamic `import()` → static import in ws-handlers.ts (P5)
- `broadcast` → `sendToSession` for session updates (P6)
- Add guard against duplicate reconnect timers in WsClient (L3)

### Architecture concerns

- `Middle-end architecture`: The `view-tracker` bridges user sessions and sockets. It works as a hash-of-sets pattern that is correct but fragile — currently two separate data structures (`connections` in ws.ts + `socketToSession`/`sessionToSockets` in view-tracker) track overlapping state. A single `SessionSocketManager` class would eliminate the duplication.
- Monitoring: `logMemory` is wired in, but only for before/after LLM turns. Adding periodic memory sampling would catch regressions.
