/**
 * Seed development data: sessions, groups, designs.
 *
 * Run: MODE=dev bun run scripts/seed-dev-data.ts
 *
 * Set environment variables to override:
 *   WORKSPACE_REPO   — repoSource workspace path (default: ../.. from __dirname)
 *   WORKSPACE_PERSONAL — personalFiles workspace path (default: ../../personalFiles)
 *   WORKSPACE_ROOT   — harness root path (default: ../.. from __dirname)
 */
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { getDbForDataDir } from "../_backend/src/db/client";
import { createSession as dbCreateSession } from "../_backend/src/features/sessions/db";
import { setSessionLayout as dbSetSessionLayout } from "../_backend/src/features/sessions/db";
import type { SessionMeta, LayoutNode } from "../_shared/types";

// ── Config ──────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, "..", "data", process.env.MODE ?? "dev");

const PROJECT_ROOT = resolve(__dirname, "..");

const WORKSPACES = {
  repoSource: process.env.WORKSPACE_REPO ?? PROJECT_ROOT,
  personalFiles: process.env.WORKSPACE_PERSONAL ?? join(PROJECT_ROOT, "personalFiles"),
  harnessRoot: process.env.WORKSPACE_ROOT ?? PROJECT_ROOT,
};

const CREATED_BY = "user" as const;

// ── Helpers ─────────────────────────────────────────────────────────

function iso(): string {
  return new Date().toISOString();
}

function makeSessionMeta(overrides: Partial<SessionMeta> & { id: string; title: string }): SessionMeta {
  return {
    providerName: "openai",
    modelName: "gpt-4o",
    created: iso(),
    updated: iso(),
    archived: false,
    kind: "primary",
    ...overrides,
  };
}

async function ensureDesignsDir(...parts: string[]): Promise<string> {
  const dir = join(...parts);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeGlobalDesign(name: string, type: "spec" | "plan", goalOrEndGoal: string): Promise<void> {
  const designsDir = join(DATA_DIR, "designs");
  const dir = await ensureDesignsDir(designsDir, name);
  const version = 1;
  const now = iso();

  if (type === "spec") {
    const doc = {
      meta: {
        id: name, version, title: name, createdAt: now, updatedAt: now,
        createdBy: CREATED_BY, status: "draft", relatedSpecs: [],
        createdMeta: { datetime: now, workspace: "", session: "" },
      },
      goal: goalOrEndGoal || "",
      requirements: [],
      constraints: [],
      assumptions: [],
      acceptanceCriteria: [],
      parts: [],
    };
    await writeFile(join(dir, `specV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  } else {
    const doc = {
      meta: {
        id: name, version, mainSpec: "", relatedSpecs: [], title: name,
        createdAt: now, updatedAt: now, completedAt: null,
        createdBy: CREATED_BY, status: "draft", tags: [],
        createdMeta: { datetime: now, workspace: "", session: "" },
      },
      endGoal: goalOrEndGoal || "",
      parts: [],
    };
    await writeFile(join(dir, `planV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  }
  console.log(`  ✓ Global design "${name}" (${type})`);
}

async function writeProjectDesign(workspaceRoot: string, name: string, type: "spec" | "plan", goalOrEndGoal: string): Promise<void> {
  const designsDir = join(workspaceRoot, ".agentHarness", "designs");
  const dir = await ensureDesignsDir(designsDir, name);
  const version = 1;
  const now = iso();

  if (type === "spec") {
    const doc = {
      meta: {
        id: name, version, title: name, createdAt: now, updatedAt: now,
        createdBy: CREATED_BY, status: "draft", relatedSpecs: [],
        createdMeta: { datetime: now, workspace: workspaceRoot, session: "" },
      },
      goal: goalOrEndGoal || "",
      requirements: [],
      constraints: [],
      assumptions: [],
      acceptanceCriteria: [],
      parts: [],
    };
    await writeFile(join(dir, `specV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  } else {
    const doc = {
      meta: {
        id: name, version, mainSpec: "", relatedSpecs: [], title: name,
        createdAt: now, updatedAt: now, completedAt: null,
        createdBy: CREATED_BY, status: "draft", tags: [],
        createdMeta: { datetime: now, workspace: workspaceRoot, session: "" },
      },
      endGoal: goalOrEndGoal || "",
      parts: [],
    };
    await writeFile(join(dir, `planV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  }
  const label = workspaceRoot.split("/").pop();
  console.log(`  ✓ Project design "${name}" (${type}) @ ${label}`);
}

async function writeSessionDesign(sessionId: string, name: string, type: "spec" | "plan", goalOrEndGoal: string): Promise<void> {
  const designsDir = join(DATA_DIR, "session", sessionId, "designs");
  const dir = await ensureDesignsDir(designsDir, name);
  const version = 1;
  const now = iso();

  if (type === "spec") {
    const doc = {
      meta: {
        id: name, version, title: name, createdAt: now, updatedAt: now,
        createdBy: CREATED_BY, status: "draft", relatedSpecs: [],
        createdMeta: { datetime: now, workspace: "", session: sessionId },
      },
      goal: goalOrEndGoal || "",
      requirements: [],
      constraints: [],
      assumptions: [],
      acceptanceCriteria: [],
      parts: [],
    };
    await writeFile(join(dir, `specV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  } else {
    const doc = {
      meta: {
        id: name, version, mainSpec: "", relatedSpecs: [], title: name,
        createdAt: now, updatedAt: now, completedAt: null,
        createdBy: CREATED_BY, status: "draft", tags: [],
        createdMeta: { datetime: now, workspace: "", session: sessionId },
      },
      endGoal: goalOrEndGoal || "",
      parts: [],
    };
    await writeFile(join(dir, `planV${version}.json`), JSON.stringify(doc, null, 2) + "\n");
  }
  console.log(`  ✓ Session design "${name}" (${type}) @ ${sessionId.substring(0, 20)}`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSeeding data into: ${DATA_DIR}\n`);

  // 1. Create sessions for each workspace
  //    Workspace: repoSource
  const repoSession1 = makeSessionMeta({
    id: "seed-2026-07-21_refactor-auth",
    title: "Refactor auth provider layer",
    workspaceRoot: WORKSPACES.repoSource,
    providerName: "openai",
    modelName: "gpt-4o",
  });
  const repoSession2 = makeSessionMeta({
    id: "seed-2026-07-21_fix-memory-leaks",
    title: "Fix memory leaks in bash sessions",
    workspaceRoot: WORKSPACES.repoSource,
    providerName: "openai",
    modelName: "o3-mini",
    thinkingEffort: "high",
  });
  const repoSession3 = makeSessionMeta({
    id: "seed-2026-07-21_add-e2e-tests",
    title: "Add Playwright tests for session list",
    workspaceRoot: WORKSPACES.repoSource,
    providerName: "anthropic",
    modelName: "claude-sonnet-4-20250514",
  });
  const repoSession4 = makeSessionMeta({
    id: "seed-2026-07-20_research-vector-search",
    title: "Research vector search for md manager",
    workspaceRoot: WORKSPACES.repoSource,
    providerName: "openai",
    modelName: "gpt-4o",
  });

  //    Workspace: personalFiles
  const persSession1 = makeSessionMeta({
    id: "seed-2026-07-20_organize-notes",
    title: "Organize research notes into mds",
    workspaceRoot: WORKSPACES.personalFiles,
    providerName: "openai",
    modelName: "gpt-4o-mini",
  });

  //    Workspace: harnessRoot
  const harnessSession1 = makeSessionMeta({
    id: "seed-2026-07-19_setup-ci",
    title: "Setup CI pipeline with GitHub Actions",
    workspaceRoot: WORKSPACES.harnessRoot,
    providerName: "openai",
    modelName: "gpt-4o",
  });
  const harnessSession2 = makeSessionMeta({
    id: "seed-2026-07-19_package-release",
    title: "Package v0.1-alpha for release",
    workspaceRoot: WORKSPACES.harnessRoot,
    providerName: "openai",
    modelName: "gpt-4o",
  });
  const harnessSession3 = makeSessionMeta({
    id: "seed-2026-07-18_documentation-audit",
    title: "Documentation audit and cleanup",
    workspaceRoot: WORKSPACES.harnessRoot,
    providerName: "openai",
    modelName: "gpt-4o",
  });

  // Insert sessions into DB
  const allSessions = [
    repoSession1, repoSession2, repoSession3, repoSession4,
    persSession1,
    harnessSession1, harnessSession2, harnessSession3,
  ];
  for (const s of allSessions) {
    try {
      dbCreateSession(s, DATA_DIR);
      console.log(`  ✓ Session "${s.title}" (${s.id.substring(0, 20)})`);
    } catch (err) {
      // May conflict if already exists
      console.log(`  ~ Session "${s.title}" (${s.id.substring(0, 20)}) — skipped (exists?)`);
    }
  }

  // 2. Set up session layouts (groups per workspace)
  async function setLayout(workspaceRoot: string, tree: LayoutNode[]) {
    try {
      dbSetSessionLayout(workspaceRoot, tree, DATA_DIR);
      console.log(`  ✓ Layout for ${workspaceRoot.split("/").pop()}`);
    } catch (err) {
      console.log(`  ~ Layout for ${workspaceRoot.split("/").pop()} — error:`, (err as Error).message);
    }
  }

  // repoSource layout: 3 groups
  await setLayout(WORKSPACES.repoSource, [
    {
      kind: "group",
      id: "g-active-dev",
      name: "Active Development",
      color: "blue",
      children: [
        { kind: "session", id: repoSession1.id },
        { kind: "session", id: repoSession2.id },
      ],
    },
    {
      kind: "group",
      id: "g-testing",
      name: "Testing & QA",
      color: "green",
      children: [
        { kind: "session", id: repoSession3.id },
      ],
    },
    {
      kind: "group",
      id: "g-research",
      name: "Research & Spikes",
      color: "violet",
      children: [
        { kind: "session", id: repoSession4.id },
      ],
    },
  ]);

  // personalFiles layout: 1 group
  await setLayout(WORKSPACES.personalFiles, [
    {
      kind: "group",
      id: "g-personal",
      name: "Personal",
      color: "amber",
      children: [
        { kind: "session", id: persSession1.id },
      ],
    },
  ]);

  // harnessRoot layout: 2 groups
  await setLayout(WORKSPACES.harnessRoot, [
    {
      kind: "group",
      id: "g-release",
      name: "Release Prep",
      color: "red",
      children: [
        { kind: "session", id: harnessSession1.id },
        { kind: "session", id: harnessSession2.id },
      ],
    },
    {
      kind: "group",
      id: "g-docs",
      name: "Documentation",
      color: "orange",
      children: [
        { kind: "session", id: harnessSession3.id },
      ],
    },
  ]);

  // 3. Create designs
  console.log("\n── Global designs ──");
  await writeGlobalDesign("auth-system", "spec", "Design and implement a provider-agnostic auth layer with API key, OAuth, and session-based auth support.");
  await writeGlobalDesign("memory-leak-fix", "plan", "Identify and fix all memory leaks in the backend process lifecycle, including orphaned bash sessions and AbortController accumulation.");
  await writeGlobalDesign("plugin-system", "spec", "Design a plugin architecture for third-party tool integrations with a registry, lifecycle hooks, and permission system.");

  console.log("\n── Project designs (repoSource) ──");
  await writeProjectDesign(WORKSPACES.repoSource, "session-list-refactor", "spec", "Refactor the session list component to support drag-and-drop grouping and real-time layout persistence.");
  await writeProjectDesign(WORKSPACES.repoSource, "e2e-test-coverage", "plan", "Achieve >80% E2E coverage on critical user flows: session creation, chat messages, tool execution, and settings.");

  console.log("\n── Session designs ──");
  await writeSessionDesign(repoSession1.id, "auth-provider-api", "spec", "Define the API contract for the auth provider interface, including login, logout, token refresh, and session validation.");
  await writeSessionDesign(repoSession3.id, "playwright-test-plan", "plan", "Write Playwright tests for session list rendering, group expand/collapse, and drag-and-drop reordering.");
  await writeSessionDesign(harnessSession3.id, "readme-overhaul", "spec", "Rewrite README.md with proper architecture documentation, API references, and contribution guide for v0.1-alpha release.");

  console.log("\n✅ Seeding complete!");
}

main().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
