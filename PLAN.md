# Memory Leak & Crash Fix Plan

> **Addresses:** Bus error crash (SIGBUS, 1.59 GB RSS at 28 min) and identified leaks.
> **Rule:** Surgical fixes only — no feature loss, no behavior changes, no new public APIs.

---

## Priority Matrix

| Pri | Fix | Issue | Impact | Files |
|-----|-----|-------|--------|-------|
| P0 | FIX 1 | ts-morph Project never freed — **root cause of crash** | ~1.5 GB leak | 3 files, ~40 lines |
| P0 | FIX 1b | `resetParserProject()` exists but never called | Contributes to FIX 1 | 1 file, +1 line |
| P0 | FIX 2 | Scanner reads each file **twice** (I/O + memory doubling) | ~575 KB per scan | 1 file, +1 line |
| P1 | FIX 3 | Auto-continue attempt maps never pruned | Unbounded Map entries | 4 files, ~20 lines |
| P1 | FIX 4 | `pendingContinueMap` entries leak on abandoned sessions | Holds content strings | 1 file, ~5 lines |
| P1 | FIX 5 | `closeWorkspaceGraphDb` doesn't close SQLite | Page cache leak | 1 file, ~10 lines |
| P1 | FIX 6 | Bash PTY session buffer unbounded | Unbounded string growth | 1 file, ~5 lines |
| P2 | FIX 7 | No memory pressure logging | Opaque debugging | 2 files, ~30 lines |
| P2 | FIX 8 | Watcher reindex re-scans all files for single change | Extra I/O + transient memory | 3 files, ~60 lines |
| P3 | FIX 9 | Raw capture buffers entire LLM response | ~2× response memory | 1 file, ~30 lines |
| P3 | FIX 10 | HookBus has no `unregister()` | Architectural gap | 1 file, ~10 lines |
| P3 | FIX 11 | Watcher debounce queue buffer unbounded under burst | Rare OOM risk | 1 file, ~5 lines |

---

## FIX 1 — P0: ts-morph Project Lifecycle

**Files:** `parser/project.ts`, `parser/parse-file.ts`, `indexer/reindex.ts`

**Problem:** Singleton `Project` in `getParserProject()` accumulates compiled ASTs. `removeSourceFile()` removes from ts-morph's list but does **not** free the TypeScript compiler program's internal SymbolTable, Type nodes, or checker caches. Over N reindex cycles (startup + watcher batches), N×115+ ASTs accumulate until SIGBUS on a freed mmap'd page.

**Fix:**
1. `project.ts` — add `createScopedProject()` returning a fresh `Project` (same compiler options as today). `getParserProject()` unchanged for backward compat.
2. `reindex.ts` — use `createScopedProject()` at start of `reindexWorkspace()` instead of `getParserProject()`.
3. `parse-file.ts` — accept optional `Project` param, defaults to `getParserProject()`.
4. Scoped project drops out of scope when `reindexWorkspace()` returns → GC reclaims memory.

**No loss:** Same options → same parse output. Existing callers of `getParserProject()` unaffected. DB write path unchanged.

**Verify:** No RSS growth between reindex cycles when no real file changes occur.

---

## FIX 1b — P0: Call `resetParserProject()` After Reindex

**File:** `indexer/reindex.ts`

**Problem:** `resetParserProject()` exists at `project.ts:27` but is never called.

**Fix:** Add `resetParserProject()` at end of `reindexWorkspace()`, after all parse & DB writes.

**No loss:** Next `getParserProject()` call creates a fresh Project (slightly slower first parse, but functionally identical).

---

## FIX 2 — P0: Eliminate Double File Reads

**File:** `scanner/scan.ts` (line 88-89)

**Problem:**
```typescript
const sourceText = await readFile(fullPath, "utf-8");     // 1st read
const fileHash = await computeFileHash(fullPath);            // 2nd read (Bun.file().arrayBuffer())
```

**Fix:** Replace with `computeSourceHash(sourceText)` — the function already exists at `hash.ts:3-16` and uses the same `Bun.hash()` algorithm.

```typescript
const fileHash = computeSourceHash(sourceText); // reuse already-read text
```

**No loss:** Identical algorithm, identical output for same bytes.

---

## FIX 3 — P1: Prune Auto-Continue Attempt Maps

**Files:** `auto-continue.ts`, `ws-chat.ts`, `spawn.ts`, `session-abort.ts`

**Problem:** `toolContinueAttempts` / `thinkingContinueAttempts` maps (`ws-chat.ts:36-37`, `spawn.ts:28-29`) accumulate entries by session ID. `canAutoContinue()` filters expired timestamps but never removes the key when the array becomes empty.

**Fix:**
1. `auto-continue.ts` — add `pruneSession(map, key)` that deletes the key from both maps.
2. `ws-chat.ts` — call after auto-continue completes (success or failure).
3. `spawn.ts` — same for subagent auto-continue.
4. `session-abort.ts` — also prune on cancel.

**No loss:** Auto-continue behavior unchanged. In-flight sessions untouched.

---

## FIX 4 — P1: Clean Up Pending Continue Map

**File:** `ws-chat.ts`, `session-abort.ts`

**Problem:** `pendingContinueMap` (`session-abort.ts:32`) entries leak when a session is abandoned mid-`switch_continue` (WebSocket disconnect). Each entry holds a `content` string.

**Fix:** Ensure WebSocket close handler in `ws-chat.ts` calls `clearPendingContinue()` after `consumePendingContinue()` returns. `cancelSession()` already clears it.

**No loss:** `consumePendingContinue()` remains authoritative. Clear after consume is idempotent.

---

## FIX 5 — P1: Close SQLite Connection

**File:** `storage/db.ts`

**Problem:** `closeWorkspaceGraphDb()` removes DB from map but never calls `sqlite.close()`. mmap'd pages and page cache remain allocated.

**Fix:** Store `{ db: WorkspaceGraphDb, sqlite: Database }` in map. On close, call `sqlite.close()` before map delete.

**No loss:** Same return type from `openWorkspaceGraphDb()`. Schema/queries unchanged.

---

## FIX 6 — P1: Bound Bash PTY Buffer

**File:** `pty-session.ts`

**Problem:** `session.buffer` concatenates ALL stdout/stderr with no cap. Only output before a waiter marker is removed. Inter-command output accumulates.

**Fix:** Add `MAX_BUFFER_SIZE = 1_048_576` (1 MB). In `onData()`, after `session.buffer += chunk`, if `buffer.length > MAX_BUFFER_SIZE`, trim: `session.buffer = session.buffer.slice(-MAX_BUFFER_SIZE)`.

**No loss:** Markers are appended at end of each command → always within recent `MAX_BUFFER_SIZE`. Normal commands (~1-10 KB) never hit cap.

---

## FIX 7 — P2: Add Memory Pressure Logging

**Files:** New `utils/memory.ts`, then `index.ts`, `ws-chat.ts`

**Problem:** No RSS history. Crash at 1.59 GB with no growth trajectory data.

**Fix:** Utility `logMemory(label)` logs `process.memoryUsage()` RSS/Heap/External. Call at:
- After startup reindex
- After each watcher reindex
- After each LLM response

**No loss:** Pure additive logging.

---

## FIX 8 — P2: Incremental Watcher Reindex

**Files:** `scanner/scan.ts`, `indexer/reindex.ts`, `index.ts`

**Problem:** `processWatcherBatch()` calls `reindexWorkspace()` which re-scans ALL files. For a single file change, ~115 files are re-read and re-hashed. In the crash, this ran concurrently with an LLM fetch.

**Fix:** Add `scanAndParseChangedFiles(workspaceRoot, dbPath, changedPaths[])` that only touches the changed paths. Falls back to full reindex for ambiguous events (deletes, renames, bulk changes).

**No loss:** Same parse+DB write logic for changed files. Same query results.

---

## FIX 9 — P3: Stream Raw Capture to Disk

**File:** `raw-capture-fetch.ts`

**Problem:** `chunks: Uint8Array[]` accumulates entire LLM streaming response before parsing. ~2× memory for the response body during streaming.

**Fix:** Write chunks to a `Bun.file()` writable stream, read back + parse on flush, delete temp file. Or add a cumulative size cap (10 MB) that stops capturing if exceeded.

**No loss:** `getResponse()` returns same parsed object. `captureDone` still resolves.

---

## FIX 10 — P3: Add `unregister()` to HookBus

**File:** `hooks/bus.ts`

**Problem:** `handlers` Map has no removal mechanism. Currently unused (startup-only registration), but an architectural gap.

**Fix:** Add `unregister(name, handlerId)` that filters the handler array by ID.

**No loss:** Pure additive API.

---

## FIX 11 — P3: Bound Watcher Debounce Queue

**File:** `watcher/debounce-queue.ts`

**Problem:** Internal `buffer: WorkspaceFsEvent[]` unbounded under rapid FS events (git checkout, npm install).

**Fix:** Add `MAX_BUFFER = 10_000`. Flush immediately if exceeded.

**No loss:** Normal single edits still debounce. Burst events trigger immediate flush.

---

## Implementation Order

```
FIX 1 → FIX 1b → FIX 7 (logging to verify)
  └─ then in any order: FIX 2 → FIX 3 → FIX 4 → FIX 5 → FIX 6
  └─ then: FIX 8 (depends on FIX 1 for full benefit)
  └─ then: FIX 9 → FIX 10 → FIX 11
```

FIX 1 is the root cause. FIX 7 enables verification. FIX 2-6 are independent. FIX 8 is optimized but only meaningfully effective after FIX 1 prevents the leak it would trigger.

---

## Verification

| Check | Criteria |
|-------|----------|
| Per-fix | See individual sections above |
| RSS stability | `bun run dev` + file saves → RSS stays flat (no +10-20 MB per reindex) |
| Long run | `bun run prod` for 30+ min, multiple turns + watcher events + bash + subagents |
| Regression | Workspace queries, bash commands, auto-continue, switch_continue, session abort all work |
| Crash regression | Bus error does not reproduce under same workload |
