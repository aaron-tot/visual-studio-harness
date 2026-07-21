import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { resolveDataDir } from "../paths";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const dbs = new Map<string, DrizzleDb>();

function ensureSchema(sqlite: Database): void {
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");

  // ── sessions (extended aggregates) ─────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider_name TEXT,
      model_name TEXT,
      workspace_root TEXT,
      kind TEXT NOT NULL DEFAULT 'primary',
      parent_id TEXT,
      task_label TEXT,
      agent_name TEXT,
      thinking_effort TEXT,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT,
      todos_json TEXT,
      model_config_json TEXT,
      session_perms_json TEXT,
      cached_input_tokens INTEGER,
      cached_output_tokens INTEGER,
      cached_total_tokens INTEGER,
      cached_turn_count INTEGER
    );
  `);

  // ── prompt_snapshots ───────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS prompt_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // ── tools_snapshots ────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS tools_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL UNIQUE,
      tools_json TEXT NOT NULL,
      tool_names_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // ── turns ──────────────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      turn_number INTEGER NOT NULL,
      user_content TEXT NOT NULL,
      user_timestamp TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      success INTEGER,
      agent_name TEXT,
      model_name TEXT,
      provider_name TEXT,
      max_steps INTEGER,
      temperature REAL,
      thinking_effort TEXT,
      system_prompt_snapshot_id INTEGER REFERENCES prompt_snapshots(id),
      tools_snapshot_id INTEGER REFERENCES tools_snapshots(id),
      finish_reason TEXT,
      error_message TEXT,
      error_raw TEXT,
      error_is_custom INTEGER,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      reasoning_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      step_count INTEGER,
      raw_request_json TEXT,
      raw_response_json TEXT
    );
  `);
  sqlite.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_turns_session_number ON turns(session_id, turn_number);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_turns_session_status ON turns(session_id, status);`);

  // ── turn_context ───────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS turn_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      context_turn_id INTEGER NOT NULL REFERENCES turns(id),
      position INTEGER NOT NULL
    );
  `);
  sqlite.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_turn_context_pos ON turn_context(turn_id, position);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_turn_context_turn_id ON turn_context(turn_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_turn_context_context_turn_id ON turn_context(context_turn_id);`);

  // ── steps ──────────────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_name TEXT,
      model_id TEXT,
      call_id TEXT,
      response_id TEXT,
      response_model_id TEXT,
      finish_reason TEXT,
      raw_finish_reason TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      reasoning_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      no_cache_input_tokens INTEGER,
      usage_raw_json TEXT,
      step_time_ms INTEGER,
      response_time_ms INTEGER,
      time_to_first_output_ms INTEGER,
      effective_output_tps REAL,
      output_tps REAL,
      input_tps REAL,
      tool_execution_ms_json TEXT,
      performance_json TEXT,
      provider_metadata_json TEXT,
      warnings_json TEXT,
      request_meta_json TEXT,
      started_at TEXT,
      completed_at TEXT
    );
  `);
  sqlite.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_steps_turn_index ON steps(turn_id, step_index);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_steps_turn_id ON steps(turn_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id);`);

  // ── step_parts ─────────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS step_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      seq INTEGER NOT NULL,
      status TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      parent_tool_call_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_step_parts_step_seq ON step_parts(step_id, seq);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_step_parts_turn_seq ON step_parts(turn_id, seq);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_step_parts_session_id ON step_parts(session_id);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_step_parts_tool_call_id ON step_parts(tool_call_id);`);

  // ── events ─────────────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_events_session_turn ON events(session_id, turn_id);`);

  // ── subagent_spawns ────────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS subagent_spawns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_session_id TEXT NOT NULL,
      parent_turn_id INTEGER NOT NULL,
      parent_turn_number INTEGER NOT NULL,
      parent_step_id INTEGER NOT NULL,
      parent_step_index INTEGER NOT NULL,
      tool_call_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL,
      child_turn_id INTEGER,
      child_turn_number INTEGER,
      kind TEXT NOT NULL,
      task_label TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_spawns_parent_session_turn ON subagent_spawns(parent_session_id, parent_turn_number);`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_spawns_child_session_id ON subagent_spawns(child_session_id);`);

  // ── session_layouts ───────────────────────────────────────────────
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS session_layouts (
      workspace_root TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      updated TEXT NOT NULL
    );
  `);

  // Dedupe then unique-index tool_call_id (prod DBs may have pre-unique duplicates)
  ensureUniqueSubagentSpawnToolCallId(sqlite);

  const alters = [
    `ALTER TABLE sessions ADD COLUMN cached_input_tokens INTEGER`,
    `ALTER TABLE sessions ADD COLUMN cached_output_tokens INTEGER`,
    `ALTER TABLE sessions ADD COLUMN cached_total_tokens INTEGER`,
    `ALTER TABLE sessions ADD COLUMN cached_turn_count INTEGER`,
    `ALTER TABLE sessions ADD COLUMN system_prompt TEXT`,
    `ALTER TABLE sessions ADD COLUMN todos_json TEXT`,
    `ALTER TABLE sessions ADD COLUMN model_config_json TEXT`,
    `ALTER TABLE sessions ADD COLUMN session_perms_json TEXT`,
  ];
  for (const sql of alters) {
    try {
      sqlite.run(sql);
    } catch {
      /* already present */
    }
  }
}

/**
 * Ensure unique tool_call_id on subagent_spawns.
 * Keeps the newest row per tool_call_id (max id), deletes older duplicates, then creates unique index.
 */
function ensureUniqueSubagentSpawnToolCallId(sqlite: Database): void {
  try {
    // Already unique?
    const idx = sqlite
      .query(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='uq_spawns_tool_call_id'`
      )
      .get() as { name?: string } | null;
    if (idx?.name) {
      try {
        sqlite.run(`DROP INDEX IF EXISTS idx_spawns_tool_call_id`);
      } catch {
        /* ignore */
      }
      return;
    }

    // Delete older duplicates (keep highest id per tool_call_id)
    const del = sqlite.run(`
      DELETE FROM subagent_spawns
      WHERE id NOT IN (
        SELECT MAX(id) FROM subagent_spawns GROUP BY tool_call_id
      )
    `);
    const changes =
      typeof (del as { changes?: number }).changes === "number"
        ? (del as { changes: number }).changes
        : 0;
    if (changes > 0) {
      console.info(
        `[db] subagent_spawns: removed ${changes} duplicate tool_call_id row(s) before unique index`
      );
    }

    sqlite.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_spawns_tool_call_id ON subagent_spawns(tool_call_id)`
    );
    try {
      sqlite.run(`DROP INDEX IF EXISTS idx_spawns_tool_call_id`);
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn(
      "[db] could not ensure uq_spawns_tool_call_id:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Open (or reuse) the SQLite DB at path.
 * Default: {dataDir}/visual-studio-harness.db for the process data dir.
 */
export function getDb(dbPath?: string): DrizzleDb {
  const path = dbPath || join(resolveDataDir(), "visual-studio-harness.db");
  let db = dbs.get(path);
  if (!db) {
    mkdirSync(join(path, ".."), { recursive: true });
    const sqlite = new Database(path);
    ensureSchema(sqlite);
    db = drizzle(sqlite, { schema });
    dbs.set(path, db);
  }
  return db;
}

/** DB for a given data directory (tests + multi-root). */
export function getDbForDataDir(dataDir: string): DrizzleDb {
  return getDb(join(dataDir, "visual-studio-harness.db"));
}
