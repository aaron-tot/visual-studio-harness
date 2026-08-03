import type { FastifyInstance } from "fastify";
import { resolve, join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  listSessions,
  listChildSessions,
  getSession,
  deleteSession,
  renameSession,
  updateSessionMeta,
  updateSessionWorkspace,
  listWorkspaces,
  getTurns,
  getTurn,
  getSessionLayout,
  setSessionLayout,
} from "./store";
import {
  listTurnSummaries,
  getTurnDetail,
  getTurnRawCaptureByNumber,
  getStepWithParts,
  getSessionUsage,
  getTurnStepRawCapture,
} from "../chat/project-chat";
import { buildUsageTree } from "../chat/usage-tree";
import { sessionHasTurns, getTurnByNumber, listContextTurnIds } from "../chat/db-trace";
import { cancelSession } from "../chat/session-abort";
import { buildModelMessages } from "../chat/message-builder";
import { promptSnapshots, turns, toolsSnapshots } from "../../db/schema";
import { getDbForDataDir } from "../../db/client";
import { eq, and } from "drizzle-orm";
import {
  getSessionTodosJson,
  setSessionTodosJson,
  getSessionModelConfigJson,
  setSessionModelConfigJson,
} from "./db";
import { getWorkspaceGraphManager } from "../../core/workspaceGraph/service-singleton";

export function registerSessionRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/sessions", async (request) => {
    const q = request.query as { include?: string };
    const includeSubagents =
      q.include === "subagents" || q.include === "all";
    return listSessions(dataDir, { includeSubagents });
  });

  app.get("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return { error: "not found" };
    return session;
  });

  app.get("/api/sessions/:id/children", async (request) => {
    const { id } = request.params as { id: string };
    const parent = await getSession(dataDir, id);
    if (!parent) return { error: "not found" };
    return listChildSessions(dataDir, id);
  });

  /** Usage tree: session → turns → steps → subagents (own + inclusive). */
  app.get("/api/sessions/:id/usage-tree", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tree = buildUsageTree(id, dataDir);
    if (!tree) return reply.code(404).send({ error: "session not found" });
    return tree;
  });

  /** Session todos — stored on sessions.todos_json in SQLite. */
  app.get("/api/sessions/:id/todos", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found", todos: [] });
    try {
      const raw = getSessionTodosJson(id, dataDir);
      if (!raw) return { todos: [] };
      const parsed = JSON.parse(raw);
      const todos = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.todos)
          ? parsed.todos
          : [];
      return { todos };
    } catch {
      return { todos: [] };
    }
  });

  app.put("/api/sessions/:id/todos", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as { todos?: unknown };
    const todos = Array.isArray(body.todos) ? body.todos : [];
    setSessionTodosJson(id, JSON.stringify(todos), dataDir);
    return { ok: true, todos };
  });

  /** Per-session model config — sessions.model_config_json in SQLite.
   *  Also stores a `context` key for context-range controls. */
  app.get("/api/sessions/:id/model-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    try {
      const raw = getSessionModelConfigJson(id, dataDir);
      if (!raw) return { models: {} };
      return JSON.parse(raw);
    } catch {
      return { models: {} };
    }
  });

  app.put("/api/sessions/:id/model-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as Record<string, unknown>;

    // Merge with existing config to preserve other keys (e.g. context)
    const existingRaw = getSessionModelConfigJson(id, dataDir);
    let existing: Record<string, unknown> = {};
    if (existingRaw) {
      try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
    }

    // If body.models is set, update models; otherwise preserve existing models
    if (body.models !== undefined) {
      existing.models = body.models;
    }

    // Merge any other top-level keys (context, etc.)
    for (const [key, val] of Object.entries(body)) {
      if (key !== "models") {
        existing[key] = val;
      }
    }

    setSessionModelConfigJson(id, JSON.stringify(existing), dataDir);
    return { ok: true };
  });

  /** Per-session context config — stored inside model_config_json.context. */
  app.get("/api/sessions/:id/context-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    try {
      const raw = getSessionModelConfigJson(id, dataDir);
      if (!raw) return { firstTurnNumber: null };
      const parsed = JSON.parse(raw);
      return parsed?.context ?? { firstTurnNumber: null };
    } catch {
      return { firstTurnNumber: null };
    }
  });

  app.put("/api/sessions/:id/context-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as {
      firstTurnNumber?: number | null;
      mode?: "auto" | "manual";
      maxTurns?: number;
      manualMode?: "turnsBack" | "pinned" | null;
      manualTurnsBack?: number | null;
    };

    // Merge with existing config
    const existingRaw = getSessionModelConfigJson(id, dataDir);
    let existing: Record<string, unknown> = {};
    if (existingRaw) {
      try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
    }

    // Merge context fields — preserve existing when not provided
    const existingCtx = (existing.context as Record<string, unknown>) ?? {};
    existing.context = {
      ...existingCtx,
      firstTurnNumber: body.firstTurnNumber !== undefined ? body.firstTurnNumber : existingCtx.firstTurnNumber ?? null,
      mode: body.mode !== undefined ? body.mode : existingCtx.mode ?? "manual",
      maxTurns: body.maxTurns !== undefined ? body.maxTurns : existingCtx.maxTurns ?? 10,
      manualMode: body.manualMode !== undefined ? body.manualMode : existingCtx.manualMode ?? "turnsBack",
      manualTurnsBack: body.manualTurnsBack !== undefined ? body.manualTurnsBack : existingCtx.manualTurnsBack ?? 10,
    };
    setSessionModelConfigJson(id, JSON.stringify(existing), dataDir);
    return { ok: true };
  });

  // ── Scoped context config (global / project) ──────────────────────────
  const contextConfigPath = join(dataDir, "context-config.json");

  async function readScopedCtx(): Promise<Record<string, unknown>> {
    try { return JSON.parse(await readFile(contextConfigPath, "utf-8")); } catch { return {}; }
  }
  async function writeScopedCtx(config: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(contextConfigPath), { recursive: true });
    await writeFile(contextConfigPath, JSON.stringify(config, null, 2));
  }

  app.get("/api/context-config/scoped", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string };
    const config = await readScopedCtx();
    if (q.scope === "global") {
      return (config.global as Record<string, unknown>) ?? { mode: "manual", maxTurns: 10, firstTurnNumber: null };
    }
    if (q.scope === "project") {
      const ws = q.workspaceRoot;
      if (!ws) return { mode: "manual", maxTurns: 10, firstTurnNumber: null };
      return ((config.workspaces as Record<string, unknown>)?.[ws] as Record<string, unknown>) ?? { mode: "manual", maxTurns: 10, firstTurnNumber: null };
    }
    return { mode: "manual", maxTurns: 10, firstTurnNumber: null };
  });

  app.put("/api/context-config/scoped", async (request) => {
    const q = request.query as { scope?: string; workspaceRoot?: string };
    const body = (request.body || {}) as Record<string, unknown>;
    const config = await readScopedCtx();
    if (q.scope === "global") {
      config.global = { ...((config.global as Record<string, unknown>) ?? {}), ...body };
    } else if (q.scope === "project") {
      const ws = q.workspaceRoot;
      if (!ws) return { error: "workspaceRoot required" };
      if (!config.workspaces) config.workspaces = {};
      (config.workspaces as Record<string, unknown>)[ws] = {
        ...(((config.workspaces as Record<string, unknown>)[ws] as Record<string, unknown>) ?? {}),
        ...body,
      };
    }
    await writeScopedCtx(config);
    return { ok: true };
  });

  // ── Effective context config resolution (session > project > global) ──
  app.get("/api/context-config/effective", async (request) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    const scopedCfg = await readScopedCtx();
    const global = (scopedCfg.global as Record<string, unknown>) ?? {};
    const project = (q.workspaceRoot
      ? ((scopedCfg.workspaces as Record<string, unknown>)?.[q.workspaceRoot] as Record<string, unknown>)
      : undefined) ?? {};

    // Session scope lives in the session's modelConfigJson .context
    let session: Record<string, unknown> = {};
    if (q.sessionId) {
      const s = await getSession(dataDir, q.sessionId);
      if (s) {
        const raw = getSessionModelConfigJson(q.sessionId, dataDir);
        if (raw) {
          try {
            const p = JSON.parse(raw);
            session = (p?.context as Record<string, unknown>) ?? {};
          } catch { /* ignore */ }
        }
      }
    }

    // Per-field resolution: session overrides project overrides global
    const pick = (key: string) => {
      if (session[key] !== undefined) return session[key];
      if (project[key] !== undefined) return project[key];
      if (global[key] !== undefined) return global[key];
      return undefined;
    };

    // Owning scope = the highest-priority scope that defines any setting.
    const hasOwn =
      (o: Record<string, unknown>) =>
        o["mode"] !== undefined || o["maxTurns"] !== undefined || o["firstTurnNumber"] !== undefined ||
        o["summarizationModel"] !== undefined || o["summarizationFallbackModel"] !== undefined || o["summarizationPromptMd"] !== undefined;
    const owner =
      hasOwn(session) ? "session"
      : hasOwn(project) ? "project"
      : hasOwn(global) ? "global"
      : "none";

    return {
      mode: (pick("mode") as string) ?? "manual",
      maxTurns: (pick("maxTurns") as number) ?? 10,
      firstTurnNumber: (pick("firstTurnNumber") as number | null) ?? null,
      manualMode: (pick("manualMode") as "turnsBack" | "pinned" | undefined) ?? "turnsBack",
      manualTurnsBack: (pick("manualTurnsBack") as number | undefined) ?? 10,
      summarizationModel: pick("summarizationModel") as string | undefined,
      summarizationFallbackModel: pick("summarizationFallbackModel") as string | undefined,
      summarizationPromptMd: pick("summarizationPromptMd") as string | undefined,
      owner,
    };
  });

  app.delete("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    const workspaceRoot = session?.meta?.workspaceRoot;
    cancelSession(id, dataDir);
    await deleteSession(dataDir, id);

    // Stop workspace graph if no remaining non-archived sessions use this root
    if (workspaceRoot?.trim()) {
      const all = await listSessions(dataDir);
      const hasOther = all.some(
        (s) => s.id !== id && s.workspaceRoot === workspaceRoot
      );
      if (!hasOther) {
        const manager = getWorkspaceGraphManager();
        if (manager) {
          manager.stop(workspaceRoot).catch((err) => {
            console.error(`[workspace-graph] error stopping for ${workspaceRoot}:`, err);
          });
        }
      }
    }

    return { ok: true };
  });

  app.put("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string; workspaceRoot?: string; starred?: boolean };
    // Workspace is set once at session start. Only allow pinning if still unset (legacy).
    if (body.workspaceRoot !== undefined) {
      const session = await getSession(dataDir, id);
      if (!session) return { error: "not found" };
      if (session.meta.workspaceRoot?.trim()) {
        return {
          error: "workspace is fixed for this session (set only at start)",
          session: session.meta,
        };
      }
      const root = normalizeWorkspace(body.workspaceRoot);
      if ("error" in root) return { error: root.error };
      const meta = await updateSessionWorkspace(dataDir, id, root.path);
      return { ok: true, session: meta };
    }
    if (body.title !== undefined) {
      await renameSession(dataDir, id, body.title);
      return { ok: true };
    }
    if (body.starred !== undefined) {
      const meta = updateSessionMeta(dataDir, id, { starred: body.starred });
      return { ok: true, session: meta };
    }
    return { error: "nothing to update" };
  });

  app.get("/api/sessions/:id/turns", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const summaries = listTurnSummaries(id, dataDir);
    return { turns: summaries };
  });

  app.get("/api/sessions/:id/turns/:turnId", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const turn = getTurnDetail(id, numTurnId, dataDir);
    if (!turn) return reply.code(404).send({ error: "turn not found" });
    return { turn };
  });

  app.get("/api/sessions/:id/turns/:turnId/raw", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const raw = await getTurnStepRawCapture(id, numTurnId, dataDir);
    if (!raw) return { rawRequest: null, rawResponse: null, steps: [] };
    return raw;
  });

  app.get("/api/sessions/:id/turns/:turnId/reconstructed-requests", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });

    const db = getDbForDataDir(dataDir);

    // Load turn record
    const turnRow = db.select().from(turns).where(and(eq(turns.sessionId, id), eq(turns.turnNumber, numTurnId))).get();
    if (!turnRow) return reply.code(404).send({ error: "turn not found" });

    // Load config snapshot
    interface ConfigSnap {
      includeFailedTurnsInHistory: boolean;
      includeToolCallsInHistory: boolean;
      includeReasoningInHistory: boolean;
      includePatchesInHistory: boolean;
      includeOtherPartsInHistory: boolean;
      contextMaxTurns?: number;
      promptSnapshotId?: number;
      toolsSnapshotId?: number;
    }
    if (!turnRow.configSnapshotJson) {
      return { sdkRequest: null, providerRequest: null };
    }
    const configSnap: ConfigSnap = JSON.parse(turnRow.configSnapshotJson);

    // Load system prompt from snapshot
    let systemBlock = "";
    if (configSnap.promptSnapshotId) {
      const sp = db.select({ content: promptSnapshots.content }).from(promptSnapshots).where(eq(promptSnapshots.id, configSnap.promptSnapshotId)).get();
      if (sp) systemBlock = sp.content;
    }

    // Load context turn IDs from turn_context table
    const ctxIds = listContextTurnIds(turnRow.id, dataDir);

    // Reconstruct SDK messages by re-running buildModelMessages
    const { messages: reconstructedMessages, contextTurnIds: usedTurnIds } = await buildModelMessages(
      id,
      systemBlock,
      {
        contextTurnIds: ctxIds,
        includeIncompleteTurns: configSnap.includeFailedTurnsInHistory,
        includeTextParts: true,
        includeTools: configSnap.includeToolCallsInHistory ?? true,
        includeReasoningParts: configSnap.includeReasoningInHistory ?? false,
        includePatchParts: configSnap.includePatchesInHistory ?? false,
        includeOtherParts: configSnap.includeOtherPartsInHistory ?? false,
        maxTurns: configSnap.contextMaxTurns,
        currentTurnNumber: turnRow.turnNumber,
        currentUserMessage: turnRow.userContent,
      },
      dataDir,
    );

    // Build SDK request object (exact object passed to streamText)
    // SDK v7 requires system as instructions param, not in messages array
    const systemMsg = reconstructedMessages[0]?.role === "system" ? reconstructedMessages[0].content : undefined;
    const sdkMessages = systemMsg ? reconstructedMessages.slice(1) : reconstructedMessages;
    const sdkRequest: Record<string, unknown> = {
      model: turnRow.modelName ?? "unknown",
      ...(systemMsg ? { instructions: systemMsg } : {}),
      messages: sdkMessages,
      temperature: turnRow.temperature ?? undefined,
      maxSteps: turnRow.maxSteps ?? undefined,
    };

    // Provider request: prefer the verbatim wire body the SDK actually sent (perfect JSON
    // schema, system converted to a role:"system" message). Fall back to reconstruction
    // from the config snapshot when no capture exists (e.g. aborted turns).
    let providerRequest: Record<string, unknown> | null = null;
    if (turnRow.rawRequestJson) {
      try {
        const captured = JSON.parse(turnRow.rawRequestJson);
        if (captured && typeof captured === "object" && !Array.isArray(captured)) {
          providerRequest = captured;
        }
      } catch {}
    }

    if (!providerRequest) {
      // Load tool definitions from snapshot to reconstruct provider request
      let providerTools: unknown[] | undefined;
      if (configSnap.toolsSnapshotId) {
        const ts = db.select({ toolsJson: toolsSnapshots.toolsJson }).from(toolsSnapshots).where(eq(toolsSnapshots.id, configSnap.toolsSnapshotId)).get();
        if (ts?.toolsJson) {
          try {
            providerTools = JSON.parse(ts.toolsJson);
          } catch {}
        }
      }

      providerRequest = {
        model: turnRow.modelName ?? "unknown",
        messages: reconstructedMessages,
        ...(providerTools ? { tools: providerTools, tool_choice: "auto" } : {}),
        stream: true,
        ...(turnRow.temperature !== null ? { temperature: turnRow.temperature } : {}),
      };
    }

    return { sdkRequest, providerRequest };
  });

  app.get("/api/sessions/:id/turns/:turnId/full", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const data = getTurnDetail(id, numTurnId, dataDir);
    if (!data) return reply.code(404).send({ error: "turn not found" });
    return data;
  });

  // ── Phase 5: Step and usage endpoints ───────────────────────────────

  app.get("/api/sessions/:id/turns/:turnId/steps", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const detail = getTurnDetail(id, numTurnId, dataDir);
    if (!detail) return reply.code(404).send({ error: "turn not found" });
    return { steps: detail.steps };
  });

  app.get("/api/sessions/:id/turns/:turnId/steps/:stepIndex", async (request, reply) => {
    const { id, turnId, stepIndex } = request.params as { id: string; turnId: string; stepIndex: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const numStepIndex = parseInt(stepIndex, 10);
    if (isNaN(numStepIndex)) return reply.code(400).send({ error: "invalid step index" });
    const step = getStepWithParts(id, numTurnId, numStepIndex, dataDir);
    if (!step) return reply.code(404).send({ error: "step not found" });
    return { step };
  });

  app.get("/api/sessions/:id/usage", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    return getSessionUsage(id, dataDir);
  });

  app.get("/api/workspaces", async () => {
    const fromSessions = await listWorkspaces(dataDir);
    return { workspaces: fromSessions };
  });

  /** Session-list layout for one workspace (group/session tree). */
  app.get("/api/session-layout", async (request) => {
    const q = request.query as { workspace?: string };
    if (q.workspace === undefined) return { error: "workspace query param required" };
    const tree = await getSessionLayout(dataDir, q.workspace);
    return { workspace: q.workspace, tree: tree ?? [] };
  });

  app.put("/api/session-layout", async (request, reply) => {
    const body = (request.body || {}) as {
      workspace?: string;
      tree?: Array<{ kind: string; id: string; name?: string; color?: string; children?: any[] }>;
    };
    if (body.workspace === undefined) {
      return reply.code(400).send({ error: "workspace required" });
    }
    if (!Array.isArray(body.tree)) {
      return reply.code(400).send({ error: "tree array required" });
    }
    // Validate tree structure
    function validateNode(n: any): boolean {
      if (!n || typeof n.id !== "string" || !n.id) return false;
      if (n.kind !== "session" && n.kind !== "group") return false;
      if (n.kind === "group" && typeof n.name !== "string") return false;
      if (n.children && !Array.isArray(n.children)) return false;
      if (n.children) return n.children.every(validateNode);
      return true;
    }
    if (!body.tree.every(validateNode)) {
      return reply.code(400).send({ error: "invalid tree node" });
    }
    await setSessionLayout(dataDir, body.workspace, body.tree);
    return { ok: true };
  });
}

export function normalizeWorkspace(input: string): { path: string } | { error: string } {
  const trimmed = (input || "").trim();
  if (!trimmed) return { error: "workspace path required" };
  let path: string;
  try {
    path = resolve(trimmed);
  } catch {
    return { error: "invalid workspace path" };
  }
  if (!existsSync(path)) return { error: "workspace path does not exist" };
  try {
    if (!statSync(path).isDirectory()) return { error: "workspace must be a directory" };
  } catch {
    return { error: "cannot access workspace path" };
  }
  return { path };
}
