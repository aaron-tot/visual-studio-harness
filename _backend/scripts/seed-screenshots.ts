/**
 * Seed demo data for screenshots.
 * Creates 3 workspaces, grouped sessions, and designs at all levels.
 * Uses the running backend API.
 *
 * Usage: bun run scripts/seed-screenshots.ts
 */

const API = "http://localhost:3001";

interface Session {
  id: string;
  title: string;
  workspace_root: string;
  created: string;
}

// ── Config ──
const workspaces = process.env.WORKSPACE_ROOTS
  ? JSON.parse(process.env.WORKSPACE_ROOTS)
  : [
      { root: "/projects/ecommerce-platform", label: "🛒 E-Commerce Platform" },
      { root: "/projects/ai-toolkit", label: "🤖 AI Toolkit" },
      { root: "/projects/personal-site", label: "👤 Personal Site" },
    ];

const sessionDefs: Array<{ wsRoot: string; title: string; agoHours: number }> = [
  // E-Commerce Platform
  { wsRoot: workspaces[0].root, title: "Audit OAuth flow for vulnerabilities", agoHours: 2 },
  { wsRoot: workspaces[0].root, title: "Review payment gateway PCI compliance", agoHours: 5 },
  { wsRoot: workspaces[0].root, title: "Fix XSS in product review form", agoHours: 8 },
  { wsRoot: workspaces[0].root, title: "Implement search autocomplete with debounce", agoHours: 12 },
  { wsRoot: workspaces[0].root, title: "Build responsive cart drawer component", agoHours: 18 },
  { wsRoot: workspaces[0].root, title: "Add product image zoom on hover", agoHours: 24 },
  { wsRoot: workspaces[0].root, title: "Design rate-limiting middleware", agoHours: 30 },
  { wsRoot: workspaces[0].root, title: "Optimize product listing query (N+1)", agoHours: 36 },
  { wsRoot: workspaces[0].root, title: "Write integration tests for order API", agoHours: 48 },
  // AI Toolkit
  { wsRoot: workspaces[1].root, title: "Refactor prompt pipeline for streaming", agoHours: 3 },
  { wsRoot: workspaces[1].root, title: "Add token usage tracking per model", agoHours: 7 },
  { wsRoot: workspaces[1].root, title: "Implement retry logic with exponential backoff", agoHours: 14 },
  { wsRoot: workspaces[1].root, title: "Build web scraping tool with Playwright", agoHours: 20 },
  { wsRoot: workspaces[1].root, title: "Add file system search tool with ripgrep", agoHours: 26 },
  { wsRoot: workspaces[1].root, title: "Create database query tool with schema inspection", agoHours: 34 },
  { wsRoot: workspaces[1].root, title: "Design conversation summarization strategy", agoHours: 40 },
  { wsRoot: workspaces[1].root, title: "Implement session persistence layer", agoHours: 50 },
  { wsRoot: workspaces[1].root, title: "Add auto-continue with turn budget tracking", agoHours: 60 },
  // Personal Site
  { wsRoot: workspaces[2].root, title: "Redesign homepage hero section", agoHours: 4 },
  { wsRoot: workspaces[2].root, title: "Build dark mode color system", agoHours: 10 },
  { wsRoot: workspaces[2].root, title: "Add scroll-triggered animations", agoHours: 16 },
  { wsRoot: workspaces[2].root, title: "Migrate blog posts from Medium", agoHours: 22 },
  { wsRoot: workspaces[2].root, title: "Add RSS feed with full content", agoHours: 28 },
  { wsRoot: workspaces[2].root, title: "Create project showcase gallery", agoHours: 36 },
];

function sessionId(ts: string): string {
  return `${ts.replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
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

async function main() {
  console.log("Using API:", API);
  const sessions: Session[] = [];

  // ── Create sessions via WS endpoint ──
  // We use the REST API for session creation since the WS endpoint
  // expects WebSocket connection. We'll insert directly via the
  // running backend's DB connection? No — let's use the REST API.
  // Actually, let's check if there's a session creation endpoint.
  // For simplicity, we'll use direct DB insert via bun:sqlite.
  // But the backend holds the DB lock. Let's use the WS approach
  // via a quick WebSocket connection.

  console.log("\n📁 Creating sessions via WebSocket...");

  const wsUrl = API.replace("http", "ws") + "/chat";
  const ws = new WebSocket(wsUrl);

  const pendingSessions: Array<{ resolve: (s: Session) => void; reject: (e: Error) => void }> = [];

  ws.onopen = () => {
    console.log("  WS connected");
    // Create sessions sequentially
    (async () => {
      for (let i = 0; i < sessionDefs.length; i++) {
        const def = sessionDefs[i];
        const created = new Date(Date.now() - def.agoHours * 3600_000).toISOString();
        const sid = sessionId(created);

        const session = await new Promise<Session>((resolve, reject) => {
          pendingSessions.push({ resolve, reject });
          ws.send(JSON.stringify({
            type: "chat:new",
            id: sid,
            name: def.title,
            workspaceRoot: def.wsRoot,
            created,
          }));
        });
        sessions.push(session);
        if ((i + 1) % 5 === 0) console.log(`  Created ${i + 1}/${sessionDefs.length} sessions`);
      }
      console.log(`  Created ${sessions.length} sessions`);
      ws.close();
    })().catch(console.error);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.type === "chat:new:done") {
        const pending = pendingSessions.shift();
        if (pending) pending.resolve(msg.data as Session);
      } else if (msg.type === "error") {
        const pending = pendingSessions.shift();
        if (pending) pending.reject(new Error(msg.error || "WS error"));
      }
    } catch (e) {
      console.error("  WS message error:", e);
    }
  };

  ws.onerror = (e) => {
    console.error("  WS error:", e);
  };

  // Wait for WS to close
  await new Promise<void>((resolve) => {
    ws.onclose = () => resolve();
  });

  if (sessions.length === 0) {
    console.log("  No sessions created — using DB fallback");
    // Fallback: insert directly via bun:sqlite
    const { Database } = await import("bun:sqlite");
    const dbPath = process.env.DB_PATH ?? `${process.env.HOME ?? "/tmp"}/.config/visual-studio-harness/visual-studio-harness.db`;
    const db = new Database(dbPath);
    for (const def of sessionDefs) {
      const created = new Date(Date.now() - def.agoHours * 3600_000).toISOString();
      const id = sessionId(created);
      db.run(
        `INSERT OR IGNORE INTO sessions (id, title, workspace_root, kind, created, updated, archived)
         VALUES (?, ?, ?, 'primary', ?, ?, 0)`,
        [id, def.title, def.wsRoot, created, now()]
      );
      sessions.push({ id, title: def.title, workspace_root: def.wsRoot, created });
    }
    db.close();
    console.log(`  Created ${sessions.length} sessions via DB`);
  }

  // ── Save session_layouts per workspace ──
  console.log("\n📋 Saving session layouts...");
  const { Database } = await import("bun:sqlite");
  const layoutDbPath = process.env.DB_PATH ?? `${process.env.HOME ?? "/tmp"}/.config/visual-studio-harness/visual-studio-harness.db`;
  const db = new Database(layoutDbPath);

  for (const ws of workspaces) {
    const wsSessions = sessions.filter((s) => s.workspace_root === ws.root);
    const layoutItems = wsSessions.map((s) => ({ kind: "session", id: s.id }));

    const existing = db.prepare("SELECT items_json FROM session_layouts WHERE workspace_root = ?").get(ws.root);
    if (existing) {
      db.run("UPDATE session_layouts SET items_json = ?, updated = ? WHERE workspace_root = ?",
        [JSON.stringify(layoutItems), now(), ws.root]);
    } else {
      db.run("INSERT INTO session_layouts (workspace_root, items_json, updated) VALUES (?, ?, ?)",
        [ws.root, JSON.stringify(layoutItems), now()]);
    }
  }
  db.close();

  // ── Create designs via REST API ──
  console.log("\n📐 Creating designs...");

  // Global
  await apiPost("/api/plans/create-spec", { name: "architecture-overview", goal: "Define the overall system architecture", scope: "global" });
  await apiPost("/api/plans/create-plan", { name: "architecture-overview", endGoal: "Documented, stable architecture", scope: "global" });
  await apiPost("/api/plans/create-spec", { name: "security-model", goal: "Define security boundaries for tool execution and file access", scope: "global" });
  await apiPost("/api/plans/create-plan", { name: "security-model", endGoal: "Defense-in-depth security with minimal user friction", scope: "global" });

  // Workspace
  for (const ws of workspaces) {
    await apiPost("/api/plans/create-spec", {
      name: `api-contract-${ws.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
      goal: `Define internal API contracts for ${ws.label}`,
      scope: "project",
      workspaceRoot: ws.root,
    });
  }

  // Session-level designs
  const sessionDesignTargets = [
    { title: "Fix XSS in product review form", name: "xss-sanitization-strategy" },
    { title: "Build web scraping tool with Playwright", name: "playwright-scraper-design" },
    { title: "Build dark mode color system", name: "dark-mode-color-tokens" },
  ];

  for (const target of sessionDesignTargets) {
    const match = sessions.find((s) => s.title === target.title);
    if (match) {
      await apiPost("/api/plans/create-spec", {
        name: target.name,
        goal: `Design for ${target.title}`,
        scope: "session",
        sessionId: match.id,
      });
    }
  }

  console.log("\n✅ Done!");
  console.log(`   ${sessions.length} sessions across ${workspaces.length} workspaces`);
  console.log(`   Global designs + ${workspaces.length} workspace designs + ${sessionDesignTargets.length} session designs`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
