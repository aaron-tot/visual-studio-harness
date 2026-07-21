/**
 * Seed demo data: 3 workspaces, grouped sessions, designs at all levels.
 *
 * Usage: bun run scripts/seed-demo-data.ts
 * Requires: backend running on port 3033 (bun run dev)
 *
 * Environment variable overrides:
 *   DATA_DIR          — config directory (default: ~/.config/visual-studio-harness)
 *   WORKSPACE_HARNESS — harness root path (default: cwd parent)
 *   WORKSPACE_PERSONAL — personal files path (default: cwd parent/personalFiles)
 *   WORKSPACE_DOCS    — docs path (default: cwd parent/personalFiles/docs)
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_DATA_DIR = `${homedir()}/.config/visual-studio-harness`;
const DATA_DIR = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
const DB_PATH = `${DATA_DIR}/visual-studio-harness.db`;

const PROJECT_ROOT = resolve(import.meta.dir, "..");

// ── Workspace paths ─────────────────────────────────────────────────────
const WORKSPACE_HARNESS = process.env.WORKSPACE_HARNESS ?? PROJECT_ROOT;
const WORKSPACE_PERSONAL = process.env.WORKSPACE_PERSONAL ?? `${PROJECT_ROOT}/personalFiles`;
const WORKSPACE_DOCS = process.env.WORKSPACE_DOCS ?? `${PROJECT_ROOT}/personalFiles/docs`;

// ── Helper: generate a nano-ish ID ──────────────────────────────────────
function generateId(): string {
  const d = new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")-00}_${String(d.getSeconds()).padStart(2, "0")}000`;
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}_${rand}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── Session factory ────────────────────────────────────────────────────
interface SessionSeed {
  id: string;
  title: string;
  workspaceRoot: string;
  groupId?: string;
  created?: string;
}

function createSessionSeed(title: string, workspaceRoot: string): SessionSeed {
  return {
    id: generateId(),
    title,
    workspaceRoot,
    created: now(),
  };
}

// ── DB helpers ──────────────────────────────────────────────────────────
function openDb(): Database {
  const db = new Database(DB_PATH);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  return db;
}

function insertSession(db: Database, s: SessionSeed): void {
  const created = s.created || now();
  db.run(
    `INSERT OR IGNORE INTO sessions (id, title, provider_name, model_name, workspace_root, kind, created, updated, archived)
     VALUES (?, ?, ?, ?, ?, 'primary', ?, ?, 0)`,
    [s.id, s.title, "openai", "gpt-4o", s.workspaceRoot, created, created]
  );
  console.log(`  Session: "${s.title}" (${s.id.slice(0, 12)}...)`);
}

function getLayout(db: Database, workspaceRoot: string): { tree: any[] } | null {
  const row = db.query(
    `SELECT items_json FROM session_layouts WHERE workspace_root = ?`
  ).get(workspaceRoot) as { items_json: string } | undefined;
  if (!row) return null;
  return { tree: JSON.parse(row.items_json) };
}

function saveLayout(db: Database, workspaceRoot: string, tree: any[]): void {
  const json = JSON.stringify(tree);
  const updated = now();
  db.run(
    `INSERT OR REPLACE INTO session_layouts (workspace_root, items_json, updated)
     VALUES (?, ?, ?)`,
    [workspaceRoot, json, updated]
  );
}

// ── Design helpers via REST API ─────────────────────────────────────────
const BASE = "http://localhost:3033";

async function createSpec(scope: string, name: string, goal: string, workspaceRoot?: string, sessionId?: string): Promise<void> {
  const body: any = { name, goal, scope };
  if (workspaceRoot) body.workspaceRoot = workspaceRoot;
  if (sessionId) body.sessionId = sessionId;
  const res = await fetch(`${BASE}/api/plans/create-spec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`  Design spec "${name}" (${scope})`);
  } else {
    console.warn(`  WARN: Failed to create spec "${name}": ${data.error}`);
  }
}

async function createPlan(scope: string, name: string, endGoal: string, workspaceRoot?: string, sessionId?: string): Promise<void> {
  const body: any = { name, endGoal, scope };
  if (workspaceRoot) body.workspaceRoot = workspaceRoot;
  if (sessionId) body.sessionId = sessionId;
  const res = await fetch(`${BASE}/api/plans/create-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`  Design plan "${name}" (${scope})`);
  } else {
    console.warn(`  WARN: Failed to create plan "${name}": ${data.error}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Seed Demo Data ===\n");

  // 1. Verify backend is running
  try {
    const health = await fetch(`${BASE}/api/sessions`);
    if (!health.ok) throw new Error(`API returned ${health.status}`);
  } catch {
    console.error("ERROR: Backend is not running on port 3033.");
    console.error("Run `bun run dev` in the repoSource directory first.");
    process.exit(1);
  }

  const db = openDb();

  // ── WORKSPACE 1: Visual Studio Harness (main project) ────────────────
  console.log("\n--- Workspace 1: Visual Studio Harness ---");

  const harnessSessions: SessionSeed[] = [
    createSessionSeed("Add session reordering with DnD", WORKSPACE_HARNESS),
    createSessionSeed("Implement design panel for global/project/session", WORKSPACE_HARNESS),
    createSessionSeed("Add keyboard shortcuts for common actions", WORKSPACE_HARNESS),
    createSessionSeed("Investigate bash process memory leak", WORKSPACE_HARNESS),
    createSessionSeed("Redesign the provider config UI", WORKSPACE_HARNESS),
    createSessionSeed("Add model search to provider settings", WORKSPACE_HARNESS),
    createSessionSeed("Fix scroll-to-bottom on new messages", WORKSPACE_HARNESS),
    createSessionSeed("Add session rename via right-click", WORKSPACE_HARNESS),
  ];

  for (const s of harnessSessions) {
    insertSession(db, s);
  }

  // Build layout with groups
  const harnessLayout = [
    {
      kind: "group",
      id: "g-features",
      name: "Features",
      color: "blue",
      children: [
        { kind: "session", id: harnessSessions[0].id },
        { kind: "session", id: harnessSessions[1].id },
        { kind: "session", id: harnessSessions[2].id },
      ],
    },
    {
      kind: "group",
      id: "g-bugs",
      name: "Bugs & Fixes",
      color: "red",
      children: [
        { kind: "session", id: harnessSessions[3].id },
        { kind: "session", id: harnessSessions[6].id },
      ],
    },
    {
      kind: "group",
      id: "g-ui",
      name: "UI Polish",
      color: "violet",
      children: [
        { kind: "session", id: harnessSessions[4].id },
        { kind: "session", id: harnessSessions[5].id },
        { kind: "session", id: harnessSessions[7].id },
      ],
    },
  ];
  saveLayout(db, WORKSPACE_HARNESS, harnessLayout);
  console.log("  Layout saved (3 groups)");

  // ── WORKSPACE 2: Personal Files / Docs ───────────────────────────────
  console.log("\n--- Workspace 2: Docs ---");

  const docsSessions: SessionSeed[] = [
    createSessionSeed("Write architecture overview doc", WORKSPACE_DOCS),
    createSessionSeed("Create API reference for plans system", WORKSPACE_DOCS),
    createSessionSeed("Document the session layout DnD feature", WORKSPACE_DOCS),
  ];

  for (const s of docsSessions) {
    insertSession(db, s);
  }

  const docsLayout = [
    {
      kind: "group",
      id: "g-writing",
      name: "Documentation",
      color: "green",
      children: docsSessions.map((s) => ({ kind: "session" as const, id: s.id })),
    },
  ];
  saveLayout(db, WORKSPACE_DOCS, docsLayout);
  console.log("  Layout saved (1 group)");

  // ── WORKSPACE 3: Personal Files root ──────────────────────────────────
  console.log("\n--- Workspace 3: Personal Files ---");

  const personalSessions: SessionSeed[] = [
    createSessionSeed("Research self-hosted AI model options", WORKSPACE_PERSONAL),
    createSessionSeed("Explore MCP server implementations", WORKSPACE_PERSONAL),
  ];

  for (const s of personalSessions) {
    insertSession(db, s);
  }

  const personalLayout = [
    {
      kind: "group",
      id: "g-research",
      name: "Research",
      color: "amber",
      children: personalSessions.map((s) => ({ kind: "session" as const, id: s.id })),
    },
  ];
  saveLayout(db, WORKSPACE_PERSONAL, personalLayout);
  console.log("  Layout saved (1 group)");

  // ── DESIGNS ──────────────────────────────────────────────────────────
  console.log("\n--- Designs at Global level ---");
  await createSpec("global", "Session DnD Groups", "Allow users to organize sessions into drag-and-drop groups within each workspace");
  await createPlan("global", "Session DnD Groups", "Implement session grouping with drag-and-drop reordering", "session-dnd-groups");
  await createSpec("global", "Tools Permissions", "Permission system for tool access per session and workspace");
  await createPlan("global", "Tools Permissions", "Implement tool permissions at workspace and session levels");

  console.log("\n--- Designs at Workspace (Harness) level ---");
  await createSpec("project", "Harness UI Refresh", "Modernize the agent harness UI", WORKSPACE_HARNESS);
  await createPlan("project", "Harness UI Refresh", "Refresh the full UI with better layout, themes, and responsive design", WORKSPACE_HARNESS);

  // Session-level designs (use the first session ID from harness)
  const sessionForDesign = harnessSessions[0].id;
  console.log(`\n--- Designs at Session level (${harnessSessions[0].title.slice(0, 40)}...) ---`);
  await createSpec("session", "DnD Group Colors", "Color-coded groups for session list organization", WORKSPACE_HARNESS, sessionForDesign);
  await createPlan("session", "DnD Group Colors", "Add color picker for session groups with 8 predefined colors", WORKSPACE_HARNESS, sessionForDesign);

  // ── Verify ────────────────────────────────────────────────────────────
  console.log("\n=== Verification ===");
  const count = db.query("SELECT COUNT(*) as c FROM sessions").get() as { c: number };
  console.log(`Total sessions in DB: ${count.c}`);

  const layoutCount = db.query("SELECT COUNT(*) as c FROM session_layouts").get() as { c: number };
  console.log(`Total workspace layouts: ${layoutCount.c}`);

  const globalDesigns = await (await fetch(`${BASE}/api/plans?scope=global`)).json();
  console.log(`Global designs: ${Array.isArray(globalDesigns) ? globalDesigns.length : 0}`);

  const projectDesigns = await (await fetch(`${BASE}/api/plans?scope=project&workspaceRoot=${encodeURIComponent(WORKSPACE_HARNESS)}`)).json();
  console.log(`Workspace designs: ${Array.isArray(projectDesigns) ? projectDesigns.length : 0}`);

  const sessionDesigns = await (await fetch(`${BASE}/api/plans?scope=session&sessionId=${encodeURIComponent(sessionForDesign)}`)).json();
  console.log(`Session designs: ${Array.isArray(sessionDesigns) ? sessionDesigns.length : 0}`);

  // Verify layouts via API
  const layoutRes = await (await fetch(`${BASE}/api/session-layout?workspace=${encodeURIComponent(WORKSPACE_HARNESS)}`)).json();
  const totalNodes = layoutRes.tree?.reduce((acc: number, g: any) => acc + (g.children?.length || 0), 0) || 0;
  console.log(`Harness layout groups: ${layoutRes.tree?.length}, sessions: ${totalNodes}`);

  db.close();
  console.log("\n=== Seed complete ===");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
