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
import { getActiveSessions } from "../../session/runtime";
import {
  listTurnSummaries,
  getTurnDetail,
  getTurnRawCaptureByNumber,
  getStepWithParts,
  getSessionUsage,
  getTurnStepRawCapture,
} from "../chat/project-chat";
import { buildUsageTree } from "../chat/usage-tree";
import { sessionHasTurns, getTurnByNumber, getNextTurnNumber, listContextTurnIds } from "../chat/db-trace";
import { cancelSession } from "../chat/session-abort";
import { buildModelMessages } from "../chat/message-builder";
import type { CoreMessage } from "ai";
import { promptSnapshots, turns, toolsSnapshots, summaryRanges, steps, stepParts } from "../../db/schema";
import { getDbForDataDir } from "../../db/client";
import { eq, and, desc, lt } from "drizzle-orm";
import {
  getSessionTodosJson,
  setSessionTodosJson,
  getSessionModelConfigJson,
  setSessionModelConfigJson,
  insertSummaryRange,
  getLatestSummaryRange,
  getLatestSummaryRangeBefore,
  getSummaryRangeByEndTurn,
  getSummaryRangeByRange,
} from "./db";
import { runSummarizer, readSummarizationPrompt, splitModelRef, buildSummarizationMessages, type SummarizerResult } from "./summarizer";
import { getWorkspaceGraphManager } from "../../core/workspaceGraph/service-singleton";
import { loadConfig } from "../../storage/config";

export function registerSessionRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/sessions", async (request) => {
    const q = request.query as { include?: string };
    const includeSubagents =
      q.include === "subagents" || q.include === "all";
    return listSessions(dataDir, { includeSubagents });
  });

  /** Active (streaming) session IDs — for frontend rehydration on refresh. */
  app.get("/api/sessions/active", async () => {
    return { sessionIds: getActiveSessions() };
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
      enabled?: boolean | null;
      summarizationModel?: string | null;
      summarizationFallbackModel?: string | null;
      summarizationPromptMd?: string | null;
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
      enabled: body.enabled !== undefined ? body.enabled : existingCtx.enabled ?? false,
      summarizationModel: body.summarizationModel !== undefined ? body.summarizationModel : existingCtx.summarizationModel ?? undefined,
      summarizationFallbackModel: body.summarizationFallbackModel !== undefined ? body.summarizationFallbackModel : existingCtx.summarizationFallbackModel ?? undefined,
      summarizationPromptMd: body.summarizationPromptMd !== undefined ? body.summarizationPromptMd : existingCtx.summarizationPromptMd ?? undefined,
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
  // Each scope may set `enabled`. When a scope is disabled (enabled === false)
  // it is entirely ignored and resolution falls through to the next scope down
  // (session → workspace/project → global). Global is always the base.
  async function resolveEffectiveContext(opts: { sessionId?: string; workspaceRoot?: string }) {
    const scopedCfg = await readScopedCtx();
    const global = (scopedCfg.global as Record<string, unknown>) ?? {};
    const project = (opts.workspaceRoot
      ? ((scopedCfg.workspaces as Record<string, unknown>)?.[opts.workspaceRoot] as Record<string, unknown>)
      : undefined) ?? {};

    // Session scope lives in the session's modelConfigJson .context
    let session: Record<string, unknown> = {};
    if (opts.sessionId) {
      const s = await getSession(dataDir, opts.sessionId);
      if (s) {
        const raw = getSessionModelConfigJson(opts.sessionId, dataDir);
        if (raw) {
          try {
            const p = JSON.parse(raw);
            session = (p?.context as Record<string, unknown>) ?? {};
          } catch { /* ignore */ }
        }
      }
    }

    // A scope only contributes when it is enabled. Default is OFF for
    // workspace/session so new scopes use global until the user opts in.
    // Global is always the base and is never gated.
const sessionEnabled = session["enabled"] === true ||
    (session["mode"] === "manual" && session["firstTurnNumber"] !== undefined && session["firstTurnNumber"] !== null);
  const projectEnabled = project["enabled"] === true;

    // Per-field resolution: session overrides project overrides global,
    // but only across scopes that are enabled.
    const pick = (key: string) => {
      if (sessionEnabled && session[key] !== undefined) return session[key];
      if (projectEnabled && project[key] !== undefined) return project[key];
      if (global[key] !== undefined) return global[key];
      return undefined;
    };

    // Owning scope = the highest-priority *enabled* scope that defines any setting.
    const hasOwn =
      (o: Record<string, unknown>) =>
        o["mode"] !== undefined || o["maxTurns"] !== undefined || o["firstTurnNumber"] !== undefined ||
        o["manualMode"] !== undefined || o["manualTurnsBack"] !== undefined ||
        o["summarizationModel"] !== undefined || o["summarizationFallbackModel"] !== undefined || o["summarizationPromptMd"] !== undefined;
    const owner =
      (sessionEnabled && hasOwn(session)) ? "session"
      : (projectEnabled && hasOwn(project)) ? "project"
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
      enabled: sessionEnabled ? true : projectEnabled ? true : false,
      owner,
    };
  }

  app.get("/api/context-config/effective", async (request) => {
    const q = request.query as { sessionId?: string; workspaceRoot?: string };
    return resolveEffectiveContext(q);
  });

  // ── Summarization test (preview how a summary would turn out) ───────────
  // Uses the shared summarizer helper from ./summarizer.ts

  app.post("/api/context-config/summarization-test", async (request, reply) => {
    const body = (request.body || {}) as {
      sessionId?: string;
      workspaceRoot?: string;
      userMessage?: string;
      agentMessage?: string;
      model?: string;
      fallbackModel?: string;
      promptMd?: string;
    };
    const userMessage = (body.userMessage ?? "").trim();
    const agentMessage = (body.agentMessage ?? "").trim();
    if (!userMessage && !agentMessage) {
      return reply.code(400).send({ error: "userMessage or agentMessage is required" });
    }

    const eff = await resolveEffectiveContext({ sessionId: body.sessionId, workspaceRoot: body.workspaceRoot });
    const modelRef = body.model ?? eff.summarizationModel;
    const fallbackModelRef = body.fallbackModel ?? eff.summarizationFallbackModel;
    const promptMd = body.promptMd ?? eff.summarizationPromptMd;

    const messages: { role: "user" | "assistant"; content: string }[] = [];
    if (userMessage) messages.push({ role: "user", content: userMessage });
    if (agentMessage) messages.push({ role: "assistant", content: agentMessage });

    try {
      const { runSummarizer } = await import("./summarizer");
      const result = await runSummarizer(dataDir, {
        promptMd,
        modelRef,
        fallbackModelRef,
        messages,
        sessionId: body.sessionId,
        workspaceRoot: body.workspaceRoot,
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const send = (delta: string) => {
        reply.raw.write(`data: ${JSON.stringify({ d: delta })}\n\n`);
      };

      // Stream the result text character by character to simulate streaming
      // (The runSummarizer collects full text; we stream it for compatibility)
      for (const char of result.text) {
        send(char);
        await new Promise((r) => setTimeout(r, 1));
      }
      reply.raw.end();
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Summarize range (create summary turn + chain range) ──────────────────

  app.post("/api/context-config/summarize-range", async (request, reply) => {
    const body = (request.body || {}) as {
      sessionId?: string;
      workspaceRoot?: string;
      startTurnNum?: number;        // optional: computed from chain tail if omitted
      endTurnNum: number;           // required: slider position (inclusive)
      promptMd?: string;            // optional: inline prompt or path
      model?: string;               // optional: "Provider/Model"
      fallbackModel?: string;       // optional: "Provider/Model"
    };

    const { sessionId, endTurnNum, startTurnNum, promptMd, model, fallbackModel, includePriorSummary } = body;
    if (!sessionId || endTurnNum == null) {
      return reply.code(400).send({ error: "sessionId and endTurnNum are required" });
    }

    const session = await getSession(dataDir, sessionId);
    if (!session) return reply.code(404).send({ error: "session not found" });

    // Resolve effective context config for the session
    const eff = await resolveEffectiveContext({ sessionId, workspaceRoot: body.workspaceRoot });
    const promptRef = promptMd ?? eff.summarizationPromptMd;
    const modelRef = model ?? eff.summarizationModel;
    const fallbackModelRef = fallbackModel ?? eff.summarizationFallbackModel;

    if (!modelRef) {
      return reply.code(400).send({ error: "No summarization model configured" });
    }

    // Validate modelRef format (should be "Provider/Model")
    const modelRefParts = modelRef.split("/");
    if (modelRefParts.length !== 2 || !modelRefParts[0] || !modelRefParts[1]) {
      return reply.code(400).send({ error: "Invalid summarization model format. Expected 'Provider/Model'" });
    }

    // Chain start = after the latest range that ends *before* the slider end.
    // This allows summarizing earlier ranges even when later ranges already exist
    // (e.g. slider at turn 3 while ranges end at 8 and 10).
    const computedEndTurnNum = endTurnNum;
    // Don't include endTurnNum in the summary range — that turn is already in context for the next turn.
    const summarizedEndTurn = computedEndTurnNum - 1;
    const priorRange = getLatestSummaryRangeBefore(dataDir, sessionId, computedEndTurnNum);
    const computedStartTurnNum = startTurnNum ?? (priorRange ? priorRange.endTurn + 1 : 1);

    // Already have a range ending at this slider position → return it (no regen).
    const atEnd = getSummaryRangeByEndTurn(dataDir, sessionId, computedEndTurnNum);
    if (atEnd) {
      const db = getDbForDataDir(dataDir);
      const summaryTurn = db.select().from(turns).where(eq(turns.id, atEnd.summaryTurnId)).get();
      const part = db
        .select({ data: stepParts.data })
        .from(stepParts)
        .where(and(eq(stepParts.turnId, atEnd.summaryTurnId), eq(stepParts.type, "text")))
        .orderBy(stepParts.seq)
        .limit(1)
        .get();
      let summaryText = "";
      try { summaryText = part?.data ? (JSON.parse(part.data).content ?? "") : ""; } catch { /* */ }
      if (!summaryText) summaryText = summaryTurn?.userContent ?? "";
      return reply.code(200).send({
        summaryTurnId: atEnd.summaryTurnId,
        rangeId: atEnd.id,
        summary: summaryText,
        tokens: atEnd.summaryTokens ?? 0,
        created: false,
        startTurn: atEnd.startTurn,
        endTurn: atEnd.endTurn,
      });
    }

    if (computedStartTurnNum > summarizedEndTurn) {
      return reply.code(400).send({
        error: `Nothing to summarize up to turn ${computedEndTurnNum} (range start ${computedStartTurnNum})`,
      });
    }

    // Idempotency: exact range already exists
    const existingRange = getSummaryRangeByRange(dataDir, sessionId, computedStartTurnNum, summarizedEndTurn);
    if (existingRange) {
      const db = getDbForDataDir(dataDir);
      const summaryTurn = db.select().from(turns).where(eq(turns.id, existingRange.summaryTurnId)).get();
      const part = db
        .select({ data: stepParts.data })
        .from(stepParts)
        .where(and(eq(stepParts.turnId, existingRange.summaryTurnId), eq(stepParts.type, "text")))
        .orderBy(stepParts.seq)
        .limit(1)
        .get();
      let summaryText = "";
      try { summaryText = part?.data ? (JSON.parse(part.data).content ?? "") : ""; } catch { /* */ }
      if (!summaryText) summaryText = summaryTurn?.userContent ?? "";
      return reply.code(200).send({
        summaryTurnId: existingRange.summaryTurnId,
        rangeId: existingRange.id,
        summary: summaryText,
        tokens: existingRange.summaryTokens ?? 0,
        created: false,
        startTurn: existingRange.startTurn,
        endTurn: existingRange.endTurn,
      });
    }

    const latestRange = priorRange; // prev link in chain for this segment

    // Build the summarizer input from the FULL conversation content of the
    // covered turns (user + assistant text, including tool output), not just
    // the raw user prompts. Reuse the chat projection which reconstructs
    // role/assistant messages from step_parts.
    const { projectSessionChat } = await import("../chat/project-chat");
    const chatMessages = projectSessionChat(sessionId, dataDir);

    const rangeTurns: { role: "user" | "assistant"; content: string }[] = [];
    const seenTurn = new Set<number>();
for (const m of chatMessages) {
      if (m.isSummary) continue;
      const tn = m.turnId;
      if (tn == null || tn < computedStartTurnNum || tn > summarizedEndTurn) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = m.content ?? "";
      if (!content) continue;
      rangeTurns.push({ role: m.role, content });
    }
    // Fallback: if projection yielded nothing (e.g. tool-only turns), include
    // the user prompts at minimum so the summarizer isn't starved of context.
    if (rangeTurns.length === 0) {
      const turnRows = getDbForDataDir(dataDir)
        .select({ turnNumber: turns.turnNumber, userContent: turns.userContent })
        .from(turns)
        .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
        .orderBy(turns.turnNumber)
        .all();
      for (const t of turnRows) {
        if (t.turnNumber >= computedStartTurnNum && t.turnNumber <= summarizedEndTurn) {
          rangeTurns.push({ role: "user", content: t.userContent });
        }
      }
    }

    // Get prior summary text if chain non-empty (summary text lives in step_parts)
    const includePrior = includePriorSummary ?? true;
    const priorSummary = includePrior && latestRange
      ? (getDbForDataDir(dataDir).select({ data: stepParts.data }).from(stepParts).where(and(eq(stepParts.turnId, latestRange.summaryTurnId), eq(stepParts.type, "text"))).orderBy(stepParts.seq).limit(1).get()?.data ?? null)
      : null;

    // Build messages for summarizer: prior summary + turns in range
    const messages = buildSummarizationMessages(priorSummary, rangeTurns);

    // Run summarizer
    let result: { text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null };
    try {
      const { runSummarizer } = await import("./summarizer");
      result = await runSummarizer(dataDir, {
        promptMd: promptRef,
        modelRef,
        fallbackModelRef,
        messages,
        sessionId,
        workspaceRoot: body.workspaceRoot,
      });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const summaryText = result.text.trim();
    const usage = result.usage;

    // Read the actual summarization prompt content (used as the user-side
    // message of the summary turn, so a human can see what instructed it).
    let promptContent = promptRef ? await readSummarizationPrompt(promptRef) : null;
    if (!promptContent) {
      promptContent = `Summarize conversation turns ${computedStartTurnNum}–${summarizedEndTurn}`;
    }

    // Compute original tokens (sum of covered turns' totalTokens)
    const coveredTurnRows = getDbForDataDir(dataDir)
      .select({ turnNumber: turns.turnNumber, totalTokens: turns.totalTokens })
      .from(turns)
      .where(and(eq(turns.sessionId, sessionId), eq(turns.kind, "turn")))
      .all();
    const originalTokens = coveredTurnRows
      .filter((t) => t.turnNumber >= computedStartTurnNum && t.turnNumber <= summarizedEndTurn)
      .reduce((sum, t) => sum + (t.totalTokens ?? 0), 0);

    // Create summary turn row (kind='summary'). Use a distinct turnNumber that
    // won't collide with real turns (getNextTurnNumber returns max+1).
    const now = new Date().toISOString();
    const summaryMeta = {
      kind: "summary",
      promptMd: promptRef ?? null,
      model: modelRef,
      provider: modelRef?.split("/")[0] ?? null,
      range: { startTurn: computedStartTurnNum, endTurn: summarizedEndTurn },
      prevRangeId: latestRange?.id ?? null,
      originalTokens,
      summaryTokens: usage?.totalTokens ?? 0,
    };
    const summaryTurnResult = getDbForDataDir(dataDir)
      .insert(turns)
      .values({
        sessionId,
        turnNumber: getNextTurnNumber(sessionId, dataDir),
        userContent: promptContent ?? `Summarize conversation turns ${computedStartTurnNum}–${summarizedEndTurn}`,
        userTimestamp: now,
        status: "success",
        success: true,
        modelName: modelRef?.split("/")[1] ?? "summarizer",
        providerName: modelRef?.split("/")[0] ?? "unknown",
        finishReason: "stop",
        durationMs: 0,
        startedAt: now,
        completedAt: now,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        reasoningTokens: usage?.reasoningTokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        stepCount: 1,
        kind: "summary",
        configSnapshotJson: JSON.stringify(summaryMeta),
      })
      .returning({ id: turns.id })
      .get();

    const summaryTurnId = summaryTurnResult?.id;
    if (!summaryTurnId) {
      return reply.code(500).send({ error: "Failed to create summary turn" });
    }

    // Create a step with the summary as assistant text part
    const stepResult = getDbForDataDir(dataDir)
      .insert(steps)
      .values({
        sessionId,
        turnId: summaryTurnId,
        stepIndex: 0,
        status: "completed",
        providerName: modelRef?.split("/")[0] ?? "unknown",
        modelId: modelRef?.split("/")[1] ?? "summarizer",
        finishReason: "stop",
        startedAt: now,
        completedAt: now,
        stepTimeMs: 0,
      })
      .returning({ id: steps.id })
      .get();

    const stepId = stepResult?.id;
    if (stepId) {
      getDbForDataDir(dataDir)
        .insert(stepParts)
        .values({
          sessionId,
          turnId: summaryTurnId,
          stepId,
          type: "text",
          seq: 0,
          status: "completed",
          data: JSON.stringify({ content: summaryText }),
          createdAt: now,
        })
        .run();
    }

    // Create summary range
    const rangeId = insertSummaryRange(dataDir, {
      sessionId,
      summaryTurnId,
      startTurn: computedStartTurnNum,
      endTurn: summarizedEndTurn,
      prevRangeId: latestRange?.id ?? null,
      originalTokens,
      summaryTokens: usage?.totalTokens ?? 0,
      createdAt: now,
    });

    // Push the updated session state to connected clients so the new summary
    // appears immediately in the UI without a manual refresh.
    try {
      const { sendSessionStateToSession } = await import("../sessions/view-tracker");
      sendSessionStateToSession(sessionId);
    } catch (err) {
      console.warn("[summarize-range] could not push session state:", err);
    }

    return reply.code(201).send({
      summaryTurnId,
      rangeId,
      summary: summaryText,
      tokens: usage?.totalTokens ?? 0,
      created: true,
      startTurn: computedStartTurnNum,
      endTurn: summarizedEndTurn,
    });
  });

  // ── Get summary ranges for a session ────────────────────────────────────

  app.get("/api/sessions/:id/summary-ranges", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });

    const ranges = getSummaryRangesForSession(dataDir, id);
    return { ranges };
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
      firstTurnNumber?: number | null;
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

    // Summary turns: reconstruct the ACTUAL summarizer input (the covered turns
    // plus the prior chain summary), NOT the normal-chat context. Re-running
    // buildModelMessages here would apply live-summary logic against the current
    // range state — prepending "[Summary of turns X-Y]" and dropping the covered
    // turns — which misrepresents what was truly sent to the provider.
    let reconstructedMessages: CoreMessage[];
    if ((turnRow.kind ?? "turn") === "summary") {
      const { projectSessionChat } = await import("../chat/project-chat");
      const range = db
        .select()
        .from(summaryRanges)
        .where(eq(summaryRanges.summaryTurnId, turnRow.id))
        .get();

      interface ChatMsgLike {
        turnId: number | null;
        isSummary?: boolean;
        role: string;
        content: string;
      }
      const chatMessages = projectSessionChat(id, dataDir) as unknown as ChatMsgLike[];

      const rangeTurns: { role: "user" | "assistant"; content: string }[] = [];
      if (range) {
        for (const m of chatMessages) {
          if (m.isSummary) continue;
          const tn = m.turnId;
          if (tn == null || tn < range.startTurn || tn > range.endTurn) continue;
          if (m.role !== "user" && m.role !== "assistant") continue;
          if (!m.content) continue;
          rangeTurns.push({ role: m.role as "user" | "assistant", content: m.content });
        }

        // Prior chain summary (if any) — text lives in the prior range's step_parts.
        let priorSummary: string | null = null;
        if (range.prevRangeId != null) {
          const prior = db
            .select()
            .from(summaryRanges)
            .where(eq(summaryRanges.id, range.prevRangeId))
            .get();
          if (prior) {
            const part = db
              .select({ data: stepParts.data })
              .from(stepParts)
              .where(and(eq(stepParts.turnId, prior.summaryTurnId), eq(stepParts.type, "text")))
              .orderBy(stepParts.seq)
              .limit(1)
              .get();
            if (part?.data) {
              try {
                const parsed = JSON.parse(part.data);
                if (typeof parsed.content === "string") priorSummary = parsed.content;
              } catch { /* ignore */ }
            }
          }
        }
        reconstructedMessages = buildSummarizationMessages(priorSummary, rangeTurns);
      } else {
        reconstructedMessages = buildSummarizationMessages(null, rangeTurns);
      }
    } else {
      // Reconstruct SDK messages by re-running buildModelMessages
      const ctxIds = listContextTurnIds(turnRow.id, dataDir);
      const built = await buildModelMessages(
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
        // maxTurns removed: slider auto mode computes firstTurnNumber as primary filter
        currentTurnNumber: turnRow.turnNumber,
        firstTurnNumber: configSnap.firstTurnNumber,
        currentUserMessage: turnRow.userContent,
      },
      dataDir,
    );
      reconstructedMessages = built.messages;
    }

    // Build SDK request object (exact object passed to streamText)
    // SDK v7 requires system as instructions param, not in messages array
    // NOTE: reconstructedMessages = base system (+ replayed additional_system_info
    // injections from prior turns, verbatim) as a display proxy; the true per-step
    // wire (including the current turn's injected pair) is captured verbatim in
    // rawRequestJson.
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
