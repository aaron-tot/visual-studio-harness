import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { join, resolve } from "node:path";
import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { initConfigWatcher } from "./config/load";
import { registerConfigRoutes } from "./rest/config";
import { registerSessionRoutes } from "./rest/sessions";
import { registerMessageRoutes } from "./rest/messages";
import { registerFsRoutes } from "./rest/fs";
import { registerPermsRoutes } from "./rest/perms";
import { registerWsHandler } from "./ws/handler";
import { broadcastConfig } from "./ws/configPush";
import { registerOpenUrlRoutes } from "./rest/open-url";
import { registerMdsRoutes } from "./rest/mds";
import { registerToolsRoutes } from "./rest/tools";
import { registerSkillsRoutes } from "./rest/skills";
import { registerAgentsRoutes } from "./rest/agents";
import { registerPlansRoutes } from "./rest/plans";
import { registerNotesRoutes } from "./rest/notes";
import { registerAuditsRoutes } from "./rest/audits";
import { registerResearchRoutes } from "./rest/research";
import { registerAuditPromptsRoutes } from "./rest/audit-prompts";
import { registerMcpRoutes } from "./rest/mcp";
import { registerWorkspaceGraphRoutes } from "./rest/workspace-graph";
import { setWorkspaceGraphManager, getWorkspaceGraphManager } from "./core/workspaceGraph/service-singleton";
import { WorkspaceGraphManager } from "./core/workspaceGraph/graph-manager";
import { listSessions } from "./features/sessions/store";
import { getMcpManager } from "./features/mcp";
import { resolveDataDir, getMode, getPort } from "./paths";
import { hasEmbeddedFrontend, registerEmbeddedFrontend } from "./frontendServe";
import { createHooksSystem, setHooksSystem } from "./features/hooks";
import { ensureGlobal } from "./features/tools/perms/store";
import { migrateToSqlite } from "./storage/migrate";
import { abortOrphanedStreamingTurns } from "./features/chat/db-trace";

import { ensureGlobalSystemPromptFile } from "./agent/system-prompt";
import { KnowledgeBaseService } from "./features/knowledge-base/knowledge-base-service";
import { registerKnowledgeRoutes } from "./features/knowledge-base/rest";
import { setKbService } from "./features/tools/builtins/knowledge_common";
import type { ConfigFile } from "../../_shared/types";

// Double-click / no TTY: re-launch inside a terminal so logs stay visible.
// Skip when already in a terminal, or when VISUAL_STUDIO_HARNESS_IN_TERMINAL=1 (nested / scripted).
function ensureTerminal(): void {
  if (process.stdin.isTTY) return;
  if (process.env.VISUAL_STUDIO_HARNESS_IN_TERMINAL === "1") return;
  if (process.env.VSH_HEADLESS === "1") return;
  const execName = process.execPath.split(/[/\\]/).pop() || "";
  if (!execName.startsWith("visual-studio-harness")) return;
  // Only attempt GUI terminal re-launch in a graphical session
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;

  const self = process.execPath;
  const env = { ...process.env, VISUAL_STUDIO_HARNESS_IN_TERMINAL: "1" };
  const terminals: string[][] = [
    ["gnome-terminal", "--", self, ...process.argv.slice(1)],
    ["x-terminal-emulator", "-e", self, ...process.argv.slice(1)],
    ["konsole", "-e", self, ...process.argv.slice(1)],
    ["xterm", "-e", self, ...process.argv.slice(1)],
  ];
  for (const cmd of terminals) {
    try {
      const proc = Bun.spawn({
        cmd,
        env,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      proc.unref();
      process.exit(0);
    } catch {
      // try next terminal
    }
  }
  // Fall through and run without a terminal if none are available
}

ensureTerminal();

const STARTED_AT = Date.now();

const MODE = getMode();
const PORT = getPort();
const DATA_DIR = resolveDataDir();

async function initLogging() {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  const logDir = join(DATA_DIR, "logs");
  await mkdir(logDir, { recursive: true });
  const logFile = join(logDir, `${ts}.txt`);

  // Always log to file when running as a compiled binary
  const LOG_TO_FILE = MODE === "prod" || !!process.env.VSH_LOG_TO_FILE;

  if (LOG_TO_FILE) {
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => {
      origLog(...args);
      appendFile(
        logFile,
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n"
      ).catch(() => {});
    };
    console.error = (...args) => {
      origError(...args);
      appendFile(
        logFile,
        "[ERROR] " +
          args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
          "\n"
      ).catch(() => {});
    };
  }

  if (LOG_REQUESTS) {
    console.log(`Logging to ${logFile}`);
  }
}

const LOG_REQUESTS = false;

async function main() {
  await initLogging().catch(() => {});

  // Spec: if global perms missing, create from template on first access.
  try {
    await ensureGlobal(DATA_DIR);
  } catch (err) {
    console.error("Failed to ensure globalPerms.json:", err);
    throw err;
  }

  // Spec: if global systemPromptBase.md missing, seed from defaults then always read disk.
  try {
    await ensureGlobalSystemPromptFile(DATA_DIR, MODE);
  } catch (err) {
    console.error("Failed to ensure systemPromptBase.md:", err);
  }

  // Phase A: hooks bus ready; emit sites land in Phase B
  setHooksSystem(createHooksSystem());

  const app = Fastify({
    logger: LOG_REQUESTS,
  });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  let currentConfig: ConfigFile = { providers: [] };

  const watcher = await initConfigWatcher(DATA_DIR, (config) => {
    currentConfig = config;
    broadcastConfig(config);
    getMcpManager().reconfigure(config).catch((err) => {
      console.error("[mcp] Failed to reconfigure:", err);
    });
  }, MODE);
  currentConfig = watcher.config;

  if (!currentConfig.mcpServers || currentConfig.mcpServers.length === 0) {
    const seedPath = resolve(join(DATA_DIR, "..", "..", "seeds", "mcp", "default.json"));
    if (existsSync(seedPath)) {
      try {
        const raw = await readFile(seedPath, "utf-8");
        const seed = JSON.parse(raw);
        if (Array.isArray(seed) && seed.length > 0) {
          currentConfig.mcpServers = seed;
          console.log(`[seed] Seeded ${seed.length} MCP server(s) from ${seedPath}`);
        }
      } catch (err) {
        console.error(`[seed] Failed to load MCP seed from ${seedPath}:`, err);
      }
    }
  }

  await getMcpManager().init(currentConfig);

  // Initialize Knowledge Base (enabled/disabled by config.knowledge.enabled)
  const knowledgeService = new KnowledgeBaseService(DATA_DIR);
  await knowledgeService.init(currentConfig.knowledge, currentConfig.providers);
  setKbService(knowledgeService);

  registerConfigRoutes(app, DATA_DIR, () => currentConfig, (c) => {
    currentConfig = c;
  });
  registerSessionRoutes(app, DATA_DIR);
  registerMessageRoutes(app, DATA_DIR, () => currentConfig);
  registerFsRoutes(app);
  registerPermsRoutes(app, DATA_DIR);
  registerOpenUrlRoutes(app);
  registerMdsRoutes(app, DATA_DIR);
  registerToolsRoutes(app);
  registerSkillsRoutes(app, DATA_DIR);
  registerAgentsRoutes(app, DATA_DIR);
  registerPlansRoutes(app, DATA_DIR);
  registerNotesRoutes(app, DATA_DIR);
  registerAuditsRoutes(app, DATA_DIR);
  registerAuditPromptsRoutes(app, DATA_DIR);
  registerResearchRoutes(app, DATA_DIR);
  registerMcpRoutes(app);

  // Workspace graph: create manager, register REST routes (per-workspace lookup via query param)
  registerWorkspaceGraphRoutes(app, () => getWorkspaceGraphManager());

  registerKnowledgeRoutes(app, knowledgeService);

  // Initialize workspace graphs in background (non-blocking) — gated by workspaceGraph config
  if (currentConfig.workspaceGraph !== false) {
    const manager = new WorkspaceGraphManager();
    setWorkspaceGraphManager(manager);

    // Discover workspaces from non-archived sessions (non-blocking)
    (async () => {
      try {
        const sessions = await listSessions(DATA_DIR, { includeSubagents: false, includeArchived: false });
        const workspaceRoots = sessions
          .map((s) => s.workspaceRoot)
          .filter((r): r is string => !!r?.trim());

        if (workspaceRoots.length > 0) {
          const unique = [...new Set(workspaceRoots)];
          await manager.initializeFromSessions(unique, { enableWatcher: true });
          console.log(`[workspace-graph] initialized for ${unique.length} unique workspace(s) from ${workspaceRoots.length} session(s)`);
        } else {
          console.log("[workspace-graph] no sessions with workspaceRoot found — waiting for lazy init");
        }
      } catch (err) {
        console.error("[workspace-graph] background init error:", err);
      }
    })();
  } else {
    console.log("[workspace-graph] disabled by config (workspaceGraph: false)");
  }

  registerWsHandler(app, () => DATA_DIR, () => currentConfig);

  app.get("/api/health", async () => ({ status: "ok", mode: MODE, dataDir: DATA_DIR }));

  // Reload signal for coordinated full-stack refresh (dev mode).
  // startedAt is the process start time — it only changes on backend restart,
  // so the frontend can detect restarts without a reload loop.
  if (MODE === "dev") {
    app.get("/api/reload-signal", async () => ({ startedAt: STARTED_AT }));
  }

  // App info: build timestamp (baked in at compile time) + install timestamp (written by installer)
  app.get("/api/app-info", async () => {
    const buildTimestamp: string | undefined = (process.env as Record<string, string | undefined>).BUILD_TIMESTAMP;
    let installedAt: string | null = null;
    try {
      const raw = await readFile(join(DATA_DIR, "install-info.json"), "utf-8");
      const parsed = JSON.parse(raw);
      installedAt = parsed.installedAt ?? null;
    } catch { /* file missing in dev or first run */ }
    return { buildTimestamp: buildTimestamp ?? null, installedAt };
  });

  // Open a folder in the OS file manager
  app.get("/api/open-folder", async (req) => {
    const path = (req.query as Record<string, string>).path;
    if (!path) return { ok: false, error: "Missing path query param" };
    const fullPath = resolve(import.meta.dir, "..", "..", "..", path);
    if (!existsSync(fullPath)) return { ok: false, error: "Path does not exist" };
    const cmd = process.platform === "win32" ? "explorer" : "xdg-open";
    Bun.spawn([cmd, fullPath], { detached: true });
    return { ok: true };
  });

  // Dev-only: run master e2e test in headed mode
  const MASTER_TEST_RESULT_FILE = join(DATA_DIR, "master-test-result.json");

  async function storeMasterTestResult(passed: boolean, exitCode: number) {
    const data = { passed, exitCode, timestamp: new Date().toISOString() };
    await writeFile(MASTER_TEST_RESULT_FILE, JSON.stringify(data), "utf-8");
  }

  async function readMasterTestResult(): Promise<{
    passed: boolean | null;
    exitCode: number | null;
    timestamp: string | null;
  }> {
    try {
      const raw = await readFile(MASTER_TEST_RESULT_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { passed: null, exitCode: null, timestamp: null };
    }
  }

  app.post("/api/run-master-test", async () => {
    if (MODE !== "dev") {
      return { ok: false, error: "Only available in dev mode" };
    }
    const repoDir = resolve(import.meta.dir, "..", "..");
    const proc = Bun.spawn([
      "bash", "-c",
      "source ~/.nvm/nvm.sh && npx playwright test testing/tests-human/master.spec.ts --config testing/playwright.config.ts --headed 2>&1"
    ], {
      cwd: repoDir,
      stdio: ["ignore", "inherit", "inherit"],
    });

    // Don't block — store result when process finishes
    proc.exited.then(async (exitCode) => {
      try {
        await storeMasterTestResult(exitCode === 0, exitCode);
        console.log(`[master-test] finished with exit code ${exitCode}`);
      } catch (err) {
        console.error("[master-test] failed to store result:", err);
      }
    });

    return { ok: true, pid: proc.pid };
  });

  app.get("/api/master-test-result", async () => {
    return readMasterTestResult();
  });

  // Prod binary serves embedded frontend; dev uses Vite on :3100
  if (MODE === "prod" || hasEmbeddedFrontend()) {
    if (hasEmbeddedFrontend()) {
      registerEmbeddedFrontend(app);
    } else {
      console.warn("Prod mode but no embedded frontend assets found.");
    }
  }

  const migrationResult = await migrateToSqlite();
  if (migrationResult.migrated > 0 || migrationResult.errors.length > 0) {
    console.log("SQLite migration:", migrationResult);
  }

  // Abort any turns left in "streaming" status from a prior crash.
  // This ensures session_state rehydration does not restore orphaned streaming
  // state on the frontend (which would cause a stuck stop button).
  abortOrphanedStreamingTurns(DATA_DIR);

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Backend running in ${MODE} mode on port ${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    if (MODE === "prod") {
      console.log(`Open http://localhost:${PORT}`);
      if (!currentConfig.headless && process.env.VSH_HEADLESS !== "1") {
        Bun.spawnSync(["xdg-open", `http://localhost:${PORT}`]);
      }
    }
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      const isHeadless = currentConfig?.headless || process.env.VSH_HEADLESS === "1";
      if (!isHeadless && process.stdin.isTTY) {
        const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>(r => rl.question("\n  Port in use. Kill old and restart? (Y/n): ", r));
        rl.close();
        if (answer.toLowerCase().startsWith("n")) { await pauseOnExit(); process.exit(1); }
      }
      console.log("  Killing old process...");
      Bun.spawnSync(["fuser", "-k", `${PORT}/tcp`]);
      await Bun.sleep(500);
      console.log("  Restarting...");
      // Re-exec the whole binary (clean slate)
      const self = process.execPath;
      watcher?.unsubscribe();
      Bun.spawnSync([self, ...process.argv.slice(1)]);
      process.exit(0);
    }
    console.error("Failed to start server:", err);
    await pauseOnExit();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await pauseOnExit();
  process.exit(1);
});

async function pauseOnExit(): Promise<void> {
  if (process.env.VISUAL_STUDIO_HARNESS_IN_TERMINAL === "1") {
    console.log("\nPress Enter to close...");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
    });
  }
}
