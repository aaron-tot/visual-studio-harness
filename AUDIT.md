# Crash & Memory Audit

**Date:** 2026-07-29  
**Binary:** VSH standalone (Bun v1.3.14)  
**Uptime at crash:** ~28 min (1,684,414ms)  
**RSS at crash:** 1.59 GB (Peak: 1.28 GB, Machine: 33.34 GB)  
**Crash:** `panic(main thread): Bus error at address 0x7F0BFE407000`

---

## Root Cause Analysis

### Primary Cause: `ts-morph` Project Memory Accumulation

**File:** `_backend/src/core/workspaceGraph/parser/project.ts:1-25`

A singleton `ts-morph.Project` is created at module level with `useInMemoryFileSystem: true` and `skipAddingFilesFromTsConfig: true`. This project is never reset — only grows.

**File:** `_backend/src/core/workspaceGraph/parser/parse-file.ts:13-56`

Every `parseWorkspaceFile()` call:
1. Creates a `SourceFile` in the global project via `project.createSourceFile(path, sourceText, { overwrite: true })`
2. Extracts symbols, imports, exports
3. Calls `project.removeSourceFile(sourceFile)` — **does not actually free the memory**

**Why this leaks:** The TypeScript compiler `Program` (created lazily by `ts-morph`'s Project) retains all SourceFiles in its `getSourceFiles()` cache. The binder, checker, and scanner all hold references to compiler nodes. `removeSourceFile()` removes the file from ts-morph's own list but does NOT invalidate the compiler program's internal SymbolTable, Type nodes, or AST cache. Each SourceFile's full AST, symbol table, and type information remain in memory.

**Trigger chain:**
1. App starts → `WorkspaceGraphManager.initializeFromSessions()` calls `reindexWorkspace()` → scans ~115+ files → parses each via `parseWorkspaceFile()` → **leaks all 115+ ASTs**
2. Watcher fires on file changes → `processWatcherBatch()` → `reindexWorkspace()` → **scans + parses all files again** → **leaks another 115+ ASTs**
3. Crash log shows: `[workspace-graph] watcher batch: 1 file(s) updated` — concurrent with LLM fetch
4. After ~28 min of operation with multiple turns, watcher cycles, and LLM calls → **1.59 GB RSS**

**Address evidence:** `0x7F0BFE407000` is a 4KB-aligned address in the mmap region. The ts-morph Project allocates many small objects (AST nodes, Symbols, Types) that end up on mmap'd heap pages. When these pages are freed by the C++ allocator but later accessed by dangling pointers in the compiler program, SIGBUS occurs.

---

### Contributing Cause #2: Workspace Scanner Reads All Files Twice

**File:** `_backend/src/core/workspaceGraph/scanner/scan.ts:88-101`

```typescript
const sourceText = await readFile(fullPath, "utf-8");     // 1st read
const fileHash = await computeFileHash(fullPath);            // 2nd read
```

**File:** `_backend/src/core/workspaceGraph/scanner/hash.ts:18-23`

```typescript
const content = await file.arrayBuffer();    // reads entire file again
return Bun.hash(new Uint8Array(content)).toString(36);
```

Each file is read **twice** during scanning:
- First: `readFile(…, "utf-8")` returns full text as string → stored in `ScannedFile.sourceText`
- Second: `computeFileHash()` → `Bun.file(filePath).arrayBuffer()` → reads entire file content again as `ArrayBuffer`

For ~115 files averaging ~5 KB each, that's:
- ~575 KB of source text in memory (one copy in the ScannedFile array)
- ~575 KB of ArrayBuffer for hash computation (transient)
- Plus the ts-morph SourceFile which keeps another copy of the source text

The `sourceText` field on `ScannedFile` is retained through the entire `reindexWorkspace()` call and is only freed when the `scanResult.created`/`modified` arrays go out of scope. During the watcher-triggered reindex (which runs concurrently with LLM streaming), this adds sudden memory pressure spikes.

---

### Contributing Cause #3: Raw Capture Buffers Entire LLM Response

**File:** `_backend/src/features/chat/raw-capture-fetch.ts:37-68`

```typescript
const chunks: Uint8Array[] = [];
// ...
const capture = new TransformStream<Uint8Array, Uint8Array>({
  transform(chunk, controller) {
    chunks.push(chunk);       // accumulates EVERY chunk
    controller.enqueue(chunk);
  },
  flush() { finishCapture(); },
  cancel() { finishCapture(); },
});
```

The entire LLM streaming response is captured in memory before forwarding. For a response of 100 KB+ (the crash shows 73 KB request → likely even larger response), the full body is duplicated:
- Once in the `chunks` array
- Once being passed through the stream to the AI SDK consumer

This is held until the stream finishes AND `rawCaptureDone` resolves (up to 3 second timeout).

---

### Memory Leak #1: Auto-Continue Attempt Maps (Unbounded)

**File:** `_backend/src/features/chat/ws-chat.ts:36-37`

```typescript
const toolContinueAttempts = new Map<string, number[]>();
const thinkingContinueAttempts = new Map<string, number[]>();
```

**File:** `_backend/src/features/subagents/spawn.ts:28-29`

```typescript
const subagentToolContinueAttempts = new Map<string, number[]>();
const subagentThinkingContinueAttempts = new Map<string, number[]>();
```

These are **module-level** maps that accumulate timestamps by session ID. They are never pruned. `canAutoContinue()` filters expired timestamps but never removes the session key when the array becomes empty. Every session that ever triggers auto-continue leaves an entry in these maps forever.

**Impact:** With `autoContinueOnToolEnd` or `autoContinueOnThinkingEnd` enabled (default), every session gets an entry. Over dozens of sessions with continuation chains of 5+ iterations, each with 5 timestamp entries, this is minor but unbounded.

---

### Memory Leak #2: Pending Continue Map

**File:** `_backend/src/features/chat/session-abort.ts:32`

```typescript
const pendingContinueMap = new Map<string, { content: string; agentName: string }>();
```

Entries are only consumed by `consumePendingContinue()` or cleared by `clearPendingContinue()`/`cancelSession()`. If a session is abandoned without a cancel message (e.g., socket closes while `switch_continue` is pending), the entry leaks. Each entry holds a prompt string (potentially large).

---

### Memory Leak #3: Bash PTY Session Buffer

**File:** `_backend/src/features/tools/host/pty-session.ts:16-17`

```typescript
interface Session {
  buffer: string;     // grows unboundedly
  waiters: Array<...>;
}
```

The `session.buffer` accumulates ALL stdout/stderr output during the bash session's lifetime. It is only cleared when a waiter's marker is found — but the buffer retains ALL output before the marker. For long-running bash sessions with many commands, this can grow substantially. The buffer is only freed when the session exits or is killed.

---

### Memory Concern #4: SQLite Connections Cached

**File:** `_backend/src/db/client.ts:10`

```typescript
const dbs = new Map<string, DrizzleDb>();
```

**File:** `_backend/src/core/workspaceGraph/storage/db.ts:9`

```typescript
const dbs = new Map<string, WorkspaceGraphDb>();
```

Both SQLite connection caches are module-level maps keyed by file path. Each entry holds a `Database` handle (mmap'd pages + page cache). `closeWorkspaceGraphDb()` only removes the entry from the map but does NOT call `sqlite.close()` on the underlying Bun SQLite Database. The SQLite memory-mapped data and page cache remain allocated.

---

### Memory Concern #5: Workspace Watcher Events Queue

**File:** `_backend/src/core/workspaceGraph/watcher/debounce-queue.ts:13`

```typescript
let buffer: WorkspaceFsEvent[] = [];
```

During rapid file changes (e.g., git operations, npm installs), the buffer can accumulate many events before the debounce timer fires. If `onFlush` takes a long time (reindex is slow), new events pile up. While typically small, under bursty FS activity this could grow.

---

### Memory Concern #6: Module-Level Event Registrations in Hooks

**File:** `_backend/src/features/hooks/bus.ts:29`

```typescript
private handlers = new Map<HookName, RegisteredHandler[]>();
```

The `HookBus` handler map is module-level and persists for the app lifetime. While handlers are properly deduplicated by ID, there is no mechanism to unregister handlers when sessions end. If external extensions or dynamic features register handlers per-session, they accumulate.

Current code only registers handlers at startup via the `system.ts` module, so this is not currently leaking, but it's an architectural concern.

---

### Performance Issue #1: Full Session History Projected Every Turn

**File:** `_backend/src/features/chat/project-chat.ts:13-97`

`projectSessionChat()` loads ALL turns from SQLite, ALL step parts for each turn, parses each JSON data blob, and assembles full `Message[]` arrays. This runs:
- On every `request_session_state` WebSocket message
- On every `sendSessionState()` call (which is at session ready + turn start)

**File:** `_backend/src/features/chat/run-turn/index.ts:278`

`buildModelMessagesFromContext()` loads every prior turn's text parts from SQLite, parsing each JSON blob. For sessions with many turns (e.g., 20+ turns with long assistant responses), this reconstructs the entire conversation from the DB each time.

This is not cached, so every LLM call re-reads and re-parses the same data from SQLite.

---

### Performance Issue #2: Workspace Graph Watcher Re-Scans All Files

**File:** `_backend/src/core/workspaceGraph/index.ts:152-166`

The watcher batch handler calls `reindexWorkspace()` with `mode: "startup"`, which:
1. Scans ALL files in the workspace (reads each file's source text + hash computation)
2. Diffs against the existing index
3. PARSES every changed file via ts-morph (creating ASTs in the global project)

For a single file change, this reads and re-checks all ~115+ files. The scan is not incremental — only the parse step is incremental (only changed files are parsed).

This is the operation that was running concurrently with the LLM fetch in the crash log (`[workspace-graph] watcher batch: 1 file(s) updated`). The concurrent memory pressure from re-reading all files + the LLM response capture + the existing ts-morph leak pushed memory past a critical threshold.

---

## Crash Sequence Reconstruction

```
Time    Event                                              Memory Delta
────    ─────                                              ────────────
T+0     App starts, reindexWorkspace()                    +~10-20 MB (ts-morph ASTs)
T+0     workspaceGraph watcher starts  
T+0     SQLite db opened  
T+~1m   User sends first message → LLM call  
        buildModelMessagesFromContext() reads prior turns  +~2-5 MB (messages)
        streamChat() with streaming  
        createVerboseFetch() captures response             +~100-500 KB
T+~5m   Watcher fires (file change)  
        reindexWorkspace() → scan + parse all files        +~10-20 MB (more leaked ASTs)
T+~10m  Multiple auto-continue turns  
        maps accumulate entries, more messages             +~5-10 MB
T+~15m  Watcher fires again                                +~10-20 MB
        ... repeats ...
T+~28m  1.59 GB RSS (Peak was 1.28 GB — still climbing)
        One more watcher batch triggered during LLM call  
        ts-morph internal pointer into freed page  
        → SIGBUS at 0x7F0BFE407000                         💥 CRASH
```

---

## Key Files to Investigate

| File | Issue |
|------|-------|
| `_backend/src/core/workspaceGraph/parser/project.ts:5` | Singleton `Project` with no lifecycle |
| `_backend/src/core/workspaceGraph/parser/parse-file.ts:18-54` | `createSourceFile` + `removeSourceFile` doesn't free |
| `_backend/src/core/workspaceGraph/scanner/scan.ts:88,89` | Reads each file twice |
| `_backend/src/core/workspaceGraph/scanner/hash.ts:18-23` | `computeFileHash` re-reads entire file |
| `_backend/src/features/chat/raw-capture-fetch.ts:41` | `chunks` accumulates entire stream |
| `_backend/src/features/chat/ws-chat.ts:36-37` | Module-level maps never pruned |
| `_backend/src/features/subagents/spawn.ts:28-29` | Module-level maps never pruned |
| `_backend/src/features/chat/session-abort.ts:32` | `pendingContinueMap` entries leak |
| `_backend/src/features/tools/host/pty-session.ts:36` | `buffer` grows unboundedly |
| `_backend/src/core/workspaceGraph/storage/db.ts:26-31` | `closeWorkspaceGraphDb` doesn't close SQLite |
| `_backend/src/core/workspaceGraph/index.ts:152-166` | Watcher re-scans all files for single change |

---

## Recommendations (No Changes — Audit Only)

### Critical

1. **Fix the ts-morph memory leak:** Replace global singleton `Project` with per-reindex-scoped projects that are fully garbage-collected after each reindex. Reset `_project = null` after reindex completes and force GC. Or avoid ts-morph entirely for workspace graph parsing — use a simpler parser (e.g., regex-based symbol extraction) since the graph only needs basic symbol/import/export info.

2. **Eliminate double file reads:** Cache the file text from the first `readFile` and reuse it for hash computation. The hash can be computed from the already-read `sourceText` string using `Bun.hash(new TextEncoder().encode(sourceText))`.

### High

3. **Prune auto-continue maps:** After auto-continue completes (success or failure), delete the session's entry from the attempt maps.

4. **Close SQLite in `closeWorkspaceGraphDb`:** Call `sqlite.close()` on the underlying Database before removing from the map.

5. **Bound bash PTY session buffer:** Cap the buffer size or periodically trim old output.

### Medium

6. **Add memory pressure logging:** Log RSS at key points (startup, after reindex, after each LLM call) so future crashes can be correlated with specific operations.

7. **Make watcher reindex incremental:** Only re-read files that have changed, not the entire workspace. The scan already diffs against the existing index — extend this to skip unchanged files entirely.

8. **Add a `resetParserProject()` call after watcher reindex:** Currently `resetParserProject()` exists but is never called. Calling it after each reindex would free accumulated ts-morph memory (though the next reindex would rebuild the project, which has its own cost).
