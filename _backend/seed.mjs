#!/usr/bin/env bun
/**
 * Seed script: populates the dev DB with demo sessions, workspaces, and designs.
 * Run while the backend is running: bun run seed.mjs
 *
 * This uses the backend API for design creation and direct SQLite for sessions
 * (since there's no standalone POST /sessions endpoint).
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const API = "http://localhost:3001";
const DATA_DIR = join(import.meta.dir, "../..", "data", "dev");
const DB_PATH = join(DATA_DIR, "visual-studio-harness.db");

const REPO_SOURCE = join(import.meta.dir, "..");
const PERSONAL_FILES = join(import.meta.dir, "..", "..", "personalFiles");
const TESTING = join(import.meta.dir, "..", "..", "testing");

const EMOJI = { ok: "\x1b[32m✓\x1b[0m", skip: "\x1b[33m–\x1b[0m", err: "\x1b[31m✗\x1b[0m" };
function log(tag, msg) { console.log(`${EMOJI.ok} [${tag}] ${msg}`); }
function skip(tag, msg) { console.log(`${EMOJI.skip} [${tag}] ${msg}`); }

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return res.json();
}

function dbExec(db, sql, ...params) {
  db.run(sql, ...params);
}

function dbInsert(db, table, data) {
  const cols = Object.keys(data);
  const vals = Object.values(data);
  const placeholders = vals.map(() => "?").join(", ");
  db.run(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`, ...vals);
}

// ── Create sessions with workspaceRoot set ──────────────────────────
function seedSessions(db) {
  const now = new Date().toISOString();

  const sessionDefs = [
    // ── repoSource workspace ──
    {
      id: "seed-repo-main",
      title: "Refactor build pipeline",
      workspaceRoot: REPO_SOURCE,
      providerName: "anthropic",
      modelName: "claude-sonnet-4-20250514",
      kind: "primary",
      created: "2026-07-20T08:00:00.000Z",
      updated: "2026-07-20T14:30:00.000Z",
    },
    {
      id: "seed-repo-auth",
      title: "Auth system redesign",
      workspaceRoot: REPO_SOURCE,
      providerName: "openai",
      modelName: "gpt-4o",
      kind: "primary",
      created: "2026-07-19T10:00:00.000Z",
      updated: "2026-07-20T09:00:00.000Z",
    },
    {
      id: "seed-repo-tests",
      title: "E2E test setup",
      workspaceRoot: REPO_SOURCE,
      providerName: "anthropic",
      modelName: "claude-sonnet-4-20250514",
      kind: "primary",
      created: "2026-07-18T16:00:00.000Z",
      updated: "2026-07-19T11:00:00.000Z",
    },
    // ── personalFiles workspace ──
    {
      id: "seed-personal-notes",
      title: "Notes migration",
      workspaceRoot: PERSONAL_FILES,
      providerName: "openai",
      modelName: "gpt-4o-mini",
      kind: "primary",
      created: "2026-07-21T07:00:00.000Z",
      updated: "2026-07-21T08:00:00.000Z",
    },
    {
      id: "seed-personal-docs",
      title: "Document templates",
      workspaceRoot: PERSONAL_FILES,
      providerName: "anthropic",
      modelName: "claude-sonnet-4-20250514",
      kind: "primary",
      created: "2026-07-18T09:00:00.000Z",
      updated: "2026-07-20T17:00:00.000Z",
    },
    // ── testing workspace ──
    {
      id: "seed-test-perf",
      title: "Performance benchmarks",
      workspaceRoot: TESTING,
      providerName: "anthropic",
      modelName: "claude-sonnet-4-20250514",
      kind: "primary",
      created: "2026-07-19T13:00:00.000Z",
      updated: "2026-07-20T10:00:00.000Z",
    },
    {
      id: "seed-test-load",
      title: "Load testing harness",
      workspaceRoot: TESTING,
      providerName: "openai",
      modelName: "gpt-4o",
      kind: "primary",
      created: "2026-07-17T15:00:00.000Z",
      updated: "2026-07-19T09:00:00.000Z",
    },
  ];

  let count = 0;
  for (const s of sessionDefs) {
    dbInsert(db, "sessions", { ...s, archived: false });
    count++;
  }
  log("sessions", `Created ${count} sessions across 3 workspaces`);
  return sessionDefs;
}

// ── Set up session layouts (groupings) ──────────────────────────────
function seedLayouts(db) {
  const layouts = [
    {
      workspaceRoot: REPO_SOURCE,
      itemsJson: JSON.stringify([
        { kind: "group", id: "g-core", name: "Core Features", color: "blue", children: [
          { kind: "session", id: "seed-repo-auth" },
          { kind: "session", id: "seed-repo-main" },
        ]},
        { kind: "group", id: "g-quality", name: "Quality", color: "green", children: [
          { kind: "session", id: "seed-repo-tests" },
        ]},
      ]),
    },
    {
      workspaceRoot: PERSONAL_FILES,
      itemsJson: JSON.stringify([
        { kind: "group", id: "g-writing", name: "Writing", color: "violet", children: [
          { kind: "session", id: "seed-personal-notes" },
          { kind: "session", id: "seed-personal-docs" },
        ]},
      ]),
    },
    {
      workspaceRoot: TESTING,
      itemsJson: JSON.stringify([
        { kind: "group", id: "g-perf", name: "Performance", color: "orange", children: [
          { kind: "session", id: "seed-test-perf" },
          { kind: "session", id: "seed-test-load" },
        ]},
      ]),
    },
  ];

  for (const l of layouts) {
    const now = new Date().toISOString();
    dbInsert(db, "session_layouts", {
      workspaceRoot: l.workspaceRoot,
      itemsJson: l.itemsJson,
      updated: now,
    });
  }
  log("layouts", "Created session groupings for 3 workspaces");
}

// ── Global designs ──────────────────────────────────────────────────
async function seedDesigns() {
  let count = 0;

  // Global designs
  const globalDesigns = [
    {
      name: "CLI-rewrite",
      endGoal: "Modern CLI interface using oclif framework",
      type: "plan",
    },
    {
      name: "agent-routing-protocol",
      endGoal: "Protocol for routing between specialized subagents",
      type: "spec",
    },
  ];

  for (const d of globalDesigns) {
    const ep = d.type === "spec" ? "/api/plans/create-spec" : "/api/plans/create-plan";
    await apiPost(ep, { name: d.name, endGoal: d.endGoal, scope: "global" });
    count++;
  }
  log("designs", `Created ${count} global design(s)`);

  // Project designs — repoSource workspace
  const repoDesigns = [
    { name: "error-handling-v2", endGoal: "Consistent error handling across all endpoints", type: "spec" },
    { name: "api-docs-generator", endGoal: "Auto-generate API docs from Zod schemas", type: "plan" },
  ];
  for (const d of repoDesigns) {
    const ep = d.type === "spec" ? "/api/plans/create-spec" : "/api/plans/create-plan";
    await apiPost(ep, { name: d.name, endGoal: d.endGoal, scope: "project", workspaceRoot: REPO_SOURCE });
    count++;
  }
  log("designs", `Created ${repoDesigns.length} project design(s) for repoSource`);

  // Project designs — personalFiles workspace
  await apiPost("/api/plans/create-spec", { name: "dotfile-manager", goal: "Manage dotfiles across machines", scope: "project", workspaceRoot: PERSONAL_FILES });
  count++;
  log("designs", "Created 1 project design for personalFiles");

  // Session-scope designs (first session in each workspace)
  try {
    await apiPost("/api/plans/create-spec", { name: "phase-4-migration", goal: "Migrate remaining file-based state to SQLite", scope: "session", sessionId: "seed-repo-main" });
    count++;
    log("designs", "Created session design for seed-repo-main");
  } catch (e) {
    skip("designs", `Session design for seed-repo-main: ${e.message}`);
  }

  try {
    await apiPost("/api/plans/create-plan", { name: "note-export-format", endGoal: "Export notes to markdown with YAML frontmatter", scope: "session", sessionId: "seed-personal-notes" });
    count++;
    log("designs", "Created session design for seed-personal-notes");
  } catch (e) {
    skip("designs", `Session design for seed-personal-notes: ${e.message}`);
  }

  log("designs", `Total: ${count} designs created across all scopes`);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("\n  Seed Data Population\n");

  if (!existsSync(DB_PATH)) {
    console.error(`DB not found at ${DB_PATH}`);
    console.error("Is the backend running? Start it with: bun run dev");
    process.exit(1);
  }

  // Check backend is alive
  try {
    await apiGet("/api/health");
  } catch (e) {
    console.error(`Backend not reachable at ${API}: ${e.message}`);
    console.error("Start with: bun run dev");
    process.exit(1);
  }
  log("api", `Backend healthy at ${API}`);

  const db = new Database(DB_PATH);

  seedSessions(db);
  seedLayouts(db);
  await seedDesigns();

  db.close();
  console.log("\n  Done — seed data ready for screenshots.\n");
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
