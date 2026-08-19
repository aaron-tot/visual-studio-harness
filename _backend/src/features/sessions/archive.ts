/**
 * Archive sessions — copy a session (and its owned graph) into the sibling
 * archive DB, then delete those rows from the live DB.
 *
 * Live DB remains the only one request handlers hit. The archive DB is
 * write-only from the app's point of view in this phase (no restore UI).
 *
 * Snapshot dedupe rules:
 * - `prompt_snapshots` / `tools_snapshots` are content-hash deduped across all
 *   sessions, and a given content_hash maps to exactly one id in live (unique
 *   index). Because we always copy snapshot rows with their live ids and the
 *   archive is populated only from live copies, the archive ·id ↔ content_hash
 *   mapping stays identical to live — so preserving ids keeps FKs valid and
 *   `INSERT OR IGNORE` is idempotent on re-archive.
 * - We never delete a snapshot from live unless zero remaining live turns/steps
 *   reference it after the owned rows are removed.
 *
 * Failure model: copy into archive is committed first; the live delete runs in
 * its own transaction afterwards. If the live delete fails after the archive
 * commit, the session exists in both — retrying the delete is idempotent
 * (archive insert uses `ON CONFLICT DO NOTHING` / `INSERT OR IGNORE` on
 * sessions.id). We never delete live before the archive copy succeeds.
 */
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { openRawDb, liveDbPath, archiveDbPath, evictDbForDataDir } from "../../db/client";

type Row = Record<string, unknown>;

/** Compact the live DB on boot when the freelist exceeds this many bytes. */
const FREELIST_COMPACT_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512 MB

function hasLargeFreelist(dataDir?: string): boolean {
  try {
    const db = new Database(liveDbPath(dataDir), { readonly: true });
    try {
      const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size;
      const freelist = (db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count;
      if (freelist * pageSize >= FREELIST_COMPACT_THRESHOLD_BYTES) {
        console.log(
          `[archive] large freelist detected (${((freelist * pageSize) / 1e6).toFixed(1)} MB) — will compact on boot`
        );
        return true;
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn("[archive] freelist check failed:", err);
  }
  return false;
}

function placeholders(n: number): string {
  if (n === 0) return "NULL";
  return Array.from({ length: n }, () => "?").join(",");
}

/** rootId + every descendant session (by parent_id), recursively. */
function computeClosure(live: Database, rootId: string): string[] {
  const rows = live
    .query(
      `WITH RECURSIVE closure(id) AS (
         SELECT id FROM sessions WHERE id = ?
         UNION
         SELECT s.id FROM sessions s JOIN closure c ON s.parent_id = c.id
       )
       SELECT id FROM closure`
    )
    .all(rootId) as Row[];
  return rows.map((r) => String(r.id));
}

function turnIdsForSessions(live: Database, closure: string[]): number[] {
  if (closure.length === 0) return [];
  const rows = live
    .query(`SELECT id FROM turns WHERE session_id IN (${placeholders(closure.length)})`)
    .all(...closure) as Row[];
  return rows.map((r) => Number(r.id));
}

function collectPromptSnapshotIds(
  live: Database,
  closure: string[]
): number[] {
  if (closure.length === 0) return [];
  const cls = placeholders(closure.length);
  // Two `IN (${cls})` occurrences → supply the closure twice.
  const rows = live
    .query(
      `SELECT snapshot_id FROM (
         SELECT DISTINCT system_prompt_snapshot_id AS snapshot_id
           FROM turns WHERE session_id IN (${cls}) AND system_prompt_snapshot_id IS NOT NULL
         UNION
         SELECT DISTINCT prompt_snapshot_id AS snapshot_id
           FROM steps WHERE session_id IN (${cls}) AND prompt_snapshot_id IS NOT NULL
       )`
    )
    .all(...closure, ...closure) as Row[];
  return rows.map((r) => Number(r.snapshot_id));
}

function collectToolsSnapshotIds(
  live: Database,
  closure: string[]
): number[] {
  if (closure.length === 0) return [];
  const rows = live
    .query(
      `SELECT DISTINCT tools_snapshot_id AS snapshot_id FROM turns
        WHERE session_id IN (${placeholders(closure.length)}) AND tools_snapshot_id IS NOT NULL`
    )
    .all(...closure) as Row[];
  return rows.map((r) => Number(r.snapshot_id));
}

function copySnapshots(
  live: Database,
  promptIds: number[],
  toolsIds: number[]
): void {
  if (promptIds.length > 0) {
    live
      .query(
        `INSERT OR IGNORE INTO archive.prompt_snapshots
           (id, content_hash, content, created_at)
         SELECT id, content_hash, content, created_at FROM main.prompt_snapshots
           WHERE id IN (${placeholders(promptIds.length)})`
      )
      .run(...promptIds);
  }
  if (toolsIds.length > 0) {
    live
      .query(
        `INSERT OR IGNORE INTO archive.tools_snapshots
           (id, content_hash, tools_json, tool_names_json, created_at)
         SELECT id, content_hash, tools_json, tool_names_json, created_at
           FROM main.tools_snapshots WHERE id IN (${placeholders(toolsIds.length)})`
      )
      .run(...toolsIds);
  }
}

/**
 * Copy the session's owned graph into an attached `archive` schema.
 * The archive DB must already be attached to `live` as `archive`.
 * Commits; on error rolls back and rethrows.
 */
function copySessionToArchive(
  live: Database,
  rootSessionId: string
): void {
  const closure = computeClosure(live, rootSessionId);
  if (closure.length === 0) return;

  const cls = placeholders(closure.length);
  const turnIds = turnIdsForSessions(live, closure);
  const tidCls = placeholders(turnIds.length);
  const promptIds = collectPromptSnapshotIds(live, closure);
  const toolsIds = collectToolsSnapshotIds(live, closure);

  live.run("BEGIN");
  try {
    copySnapshots(live, promptIds, toolsIds);

    live
      .query(`INSERT OR IGNORE INTO archive.sessions SELECT * FROM main.sessions WHERE id IN (${cls})`)
      .run(...closure);
    live
      .query(`INSERT OR IGNORE INTO archive.turns SELECT * FROM main.turns WHERE session_id IN (${cls})`)
      .run(...closure);
    live
      .query(`INSERT OR IGNORE INTO archive.steps SELECT * FROM main.steps WHERE session_id IN (${cls})`)
      .run(...closure);
    live
      .query(`INSERT OR IGNORE INTO archive.step_parts SELECT * FROM main.step_parts WHERE session_id IN (${cls})`)
      .run(...closure);
    if (turnIds.length > 0) {
      live
        .query(`INSERT OR IGNORE INTO archive.turn_context SELECT * FROM main.turn_context WHERE turn_id IN (${tidCls})`)
        .run(...turnIds);
    }
    live
      .query(`INSERT OR IGNORE INTO archive.summary_ranges SELECT * FROM main.summary_ranges WHERE session_id IN (${cls})`)
      .run(...closure);
    live
      .query(
        `INSERT OR IGNORE INTO archive.subagent_spawns
           SELECT * FROM main.subagent_spawns
           WHERE parent_session_id IN (${cls}) OR child_session_id IN (${cls})`
      )
      .run(...closure, ...closure);
    live
      .query(`INSERT OR IGNORE INTO archive.events SELECT * FROM main.events WHERE session_id IN (${cls})`)
      .run(...closure);

    live.run("COMMIT");
  } catch (err) {
    live.run("ROLLBACK");
    throw err;
  }
}

/**
 * Delete the session's owned rows from the live DB in one transaction,
 * as a fresh connection. Snapshot rows are only deleted when no remaining
 * live turns/steps reference them.
 */
function deleteFromLive(livePath: string, rootSessionId: string): void {
  const live = new Database(livePath);
  try {
    const closure = computeClosure(live, rootSessionId);
    if (closure.length === 0) return;

    const cls = placeholders(closure.length);
    const turnIds = turnIdsForSessions(live, closure);
    const tidCls = placeholders(turnIds.length);
    const promptIds = collectPromptSnapshotIds(live, closure);
    const toolsIds = collectToolsSnapshotIds(live, closure);

    live.run("BEGIN");
    try {
      if (turnIds.length > 0) {
        live
          .query(`DELETE FROM turn_context WHERE turn_id IN (${tidCls})`)
          .run(...turnIds);
      }
      live
        .query(`DELETE FROM step_parts WHERE session_id IN (${cls})`)
        .run(...closure);
      live
        .query(`DELETE FROM steps WHERE session_id IN (${cls})`)
        .run(...closure);
      live
        .query(`DELETE FROM turns WHERE session_id IN (${cls})`)
        .run(...closure);
      live
        .query(`DELETE FROM summary_ranges WHERE session_id IN (${cls})`)
        .run(...closure);
      live
        .query(
          `DELETE FROM subagent_spawns WHERE parent_session_id IN (${cls}) OR child_session_id IN (${cls})`
        )
        .run(...closure, ...closure);
      live
        .query(`DELETE FROM events WHERE session_id IN (${cls})`)
        .run(...closure);
      live
        .query(`DELETE FROM sessions WHERE id IN (${cls})`)
        .run(...closure);

      deleteUnreferencedSnapshots(live, promptIds, toolsIds);

      live.run("COMMIT");
    } catch (err) {
      live.run("ROLLBACK");
      throw err;
    }
  } finally {
    live.close();
  }
}

function deleteUnreferencedSnapshots(
  live: Database,
  promptIds: number[],
  toolsIds: number[]
): void {
  if (promptIds.length > 0) {
    live
      .query(
        `DELETE FROM prompt_snapshots WHERE id IN (${placeholders(promptIds.length)})
           AND NOT EXISTS (
             SELECT 1 FROM turns t WHERE t.system_prompt_snapshot_id = prompt_snapshots.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM steps s WHERE s.prompt_snapshot_id = prompt_snapshots.id
           )`
      )
      .run(...promptIds);
  }
  if (toolsIds.length > 0) {
    live
      .query(
        `DELETE FROM tools_snapshots WHERE id IN (${placeholders(toolsIds.length)})
           AND NOT EXISTS (
             SELECT 1 FROM turns tr WHERE tr.tools_snapshot_id = tools_snapshots.id
           )`
      )
      .run(...toolsIds);
  }
}

/**
 * Archive a session: ensure archive schema, copy the owned graph into it
 * (committed), then delete from live. Returns true when a session graph was
 * moved, false when the root session didn't exist.
 */
export function moveSessionToArchive(
  dataDir: string | undefined,
  rootSessionId: string
): boolean {
  const livePath = liveDbPath(dataDir);
  const archPath = archiveDbPath(dataDir);

  // Ensure the archive file/schema exists (idempotent). Opened out-of-band —
  // not on the getDb() singleton used by request handlers.
  openRawDb(archPath).close();

  const live = new Database(livePath);
  try {
    live.run(`ATTACH DATABASE ? AS archive`, [archPath]);
    try {
      copySessionToArchive(live, rootSessionId);
    } finally {
      try {
        live.run(`DETACH DATABASE archive`);
      } catch {
        /* already detached */
      }
    }
  } finally {
    live.close();
  }

  // Archive copy committed. Delete from live in its own transaction.
  deleteFromLive(livePath, rootSessionId);
  return true;
}

/**
 * Compact the live DB so the file actually shrinks on disk, returning the
 * number of bytes freed. Runs a full VACUUM after checkpointing the WAL.
 *
 * Callers must not have any in-flight writes to the live DB when this runs
 * (the compaction endpoint aborts sessions first; the boot migration runs it
 * before the server binds). The shared singleton connection is evicted first
 * because SQLite defers the file truncate until the last connection closes —
 * so "after" is measured after this function's own connection closes too.
 */
export function compactLiveDb(
  dataDir?: string
): { beforeBytes: number; afterBytes: number; freedBytes: number } {
  const livePath = liveDbPath(dataDir);
  const sizeOf = (): number => {
    try {
      return statSync(livePath).size;
    } catch {
      return 0;
    }
  };

  // Free the shared connection so VACUUM can truncate the file right away.
  evictDbForDataDir(dataDir);

  const vacuum = new Database(livePath);
  let beforeBytes: number;
  try {
    vacuum.run("PRAGMA busy_timeout = 10000");
    // Fold any WAL pages into the main file so the bytes we measure are real,
    // and so the subsequent VACUUM can actually shrink the file.
    vacuum.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
    beforeBytes = sizeOf();
    vacuum.run("VACUUM");
  } finally {
    vacuum.close();
  }
  // SQLite defers the file truncation until the last open connection closes
  // AND a new connection re-opens the file. Reopen once so the shrink lands,
  // then measure "after".
  const force = new Database(livePath);
  try {
    force.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } finally {
    force.close();
  }
  const afterBytes = sizeOf();
  const freedBytes = Math.max(0, beforeBytes - afterBytes);
  console.log(
    `[archive] compact live DB: ${(beforeBytes / 1e6).toFixed(1)} MB -> ${(afterBytes / 1e6).toFixed(1)} MB (freed ${(freedBytes / 1e6).toFixed(1)} MB)`
  );
  return {
    beforeBytes,
    afterBytes,
    freedBytes,
  };
}

/**
 * One-shot boot migration: move every live `archived = 1` session (and any
 * subagent descendants, even if not flagged) into the archive DB.
 * Idempotent — safe to run every boot; no-ops when nothing is archived.
 * When sessions were moved, the live DB is compacted so the freed disk is
 * actually reclaimed.
 */
export function migrateArchivedSessions(dataDir?: string): {
  moved: number;
  failed: string[];
  compacted?: { beforeBytes: number; afterBytes: number; freedBytes: number };
} {
  const live = new Database(liveDbPath(dataDir));
  const archived = live
    .query(`SELECT id FROM sessions WHERE archived = 1`)
    .all() as Row[];
  live.close();

  console.log(
    `[archive] migration: found ${archived.length} archived session(s) in live DB`
  );

  const failed: string[] = [];
  let moved = 0;
  for (const row of archived) {
    const id = String(row.id);
    try {
      if (moveSessionToArchive(dataDir, id)) {
        moved++;
        console.log(`[archive] moved session ${id} -> archive.db`);
      }
    } catch (err) {
      failed.push(id);
      console.error(
        `[archive] migration failed for ${id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Reclaim the space freed by the move. Also reclaims leftover freelist
  // bloat (e.g. from an extract that already deleted its live rows on a prior
  // build that didn't vacuum) even when nothing moved this boot.
  if (moved > 0 || hasLargeFreelist(dataDir)) {
    try {
      const compacted = compactLiveDb(dataDir);
      if (compacted.freedBytes > 0) {
        console.log(
          `[archive] compacted live DB after migration: freed ${(compacted.freedBytes / 1e6).toFixed(1)} MB`
        );
      }
      return { moved, failed, compacted };
    } catch (err) {
      console.error("[archive] post-migration compaction failed:", err);
    }
  } else if (archived.length === 0) {
    console.log("[archive] migration: nothing to do — no archived sessions in live DB");
  }

  return { moved, failed };
}
