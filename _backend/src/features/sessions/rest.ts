import type { FastifyInstance } from "fastify";
import { resolve, join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  listSessions,
  listChildSessions,
  getLiveSessionMeta,
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
import { buildUsageTree, buildTurnStepsTree } from "../chat/usage-tree";
import { sessionHasTurns, getTurnByNumber, getNextTurnNumber, listContextTurnIds, createTurn, createStep, finalizeStep } from "../chat/db-trace";
import { cancelSession, abortAllActiveSessions } from "../chat/session-abort";
import { compactLiveDb } from "./archive";
import { sendSessionStateToSession } from "./view-tracker";
import { buildModelMessages } from "../chat/message-builder";
import type { ModelMessage as CoreMessage } from "ai";
import { promptSnapshots, turns, toolsSnapshots, summaryRanges, steps, stepParts } from "../../db/schema";
import { getDbForDataDir } from "../../db/client";
import { eq, and, desc, lt } from "drizzle-orm";
import {
  getSessionTodosJson,
  setSessionTodosJson,
  getSessionModelConfigJson,
  setSessionModelConfigJson,
  getSessionDraftInput,
  setSessionDraftInput,
  insertSummaryRange,
  getLatestSummaryRange,
  getLatestSummaryRangeBefore,
  getSummaryRangeByEndTurn,
  getSummaryRangeByRange,
  getSummaryRangesForSession,
  getPendingSummaryTurns,
  expireStaleSummaryPlaceholders,
} from "./db";
import { readSummarizationPrompt, buildSummarizationMessages } from "./summarizer";
import { runSummaryBlock, type BlockSummaryResult } from "./summarize-block";
import { resolveSummarizerContextLimit, perBlockBudget, planChunks, extractPriorTurns } from "./summary-blocks";

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

  /**
   * Manual DB compaction: abort all in-flight sessions so nothing is writing,
   * then VACUUM the main DB so archived/deleted rows actually free disk.
   */
  app.post("/api/db/compact", async (_request, reply) => {
    const aborted = abortAllActiveSessions(dataDir);
    // Give aborted turns a brief moment to unwind current writes.
    await new Promise((r) => setTimeout(r, 250));
    try {
      const compacted = compactLiveDb(dataDir);
      return { ok: true, abortedSessions: aborted.length, ...compacted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({
        ok: false,
        error: message,
        abortedSessions: aborted.length,
      });
    }
  });

  app.get("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const meta = await getLiveSessionMeta(dataDir, id);
    if (!meta) return { error: "not found" };
    return meta;
  });

  app.get("/api/sessions/:id/children", async (request) => {
    const { id } = request.params as { id: string };
    const parent = await getLiveSessionMeta(dataDir, id);
    if (!parent) return { error: "not found" };
    return listChildSessions(dataDir, id);
  });

  /** Usage tree: session → turns → steps → subagents (own + inclusive). Shallow (steps: []). */
  app.get("/api/sessions/:id/usage-tree", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tree = buildUsageTree(id, dataDir);
    if (!tree) return reply.code(404).send({ error: "session not found" });
    return tree;
  });

  /** Steps for a single turn (usage/timing/model only — never raw_*). Lazy-load on expand. */
  app.get("/api/sessions/:id/usage-tree/turns/:turnNumber", async (request, reply) => {
    const { id, turnNumber } = request.params as { id: string; turnNumber: string };
    const n = Number(turnNumber);
    if (!Number.isInteger(n)) return reply.code(400).send({ error: "invalid turn number" });
    const turn = buildTurnStepsTree(id, n, dataDir);
    if (!turn) return reply.code(404).send({ error: "session or turn not found" });
    return { turn };
  });

  /** Session todos — stored on sessions.todos_json in SQLite. */
  app.get("/api/sessions/:id/todos", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as { todos?: unknown };
    const todos = Array.isArray(body.todos) ? body.todos : [];
    setSessionTodosJson(id, JSON.stringify(todos), dataDir);
    return { ok: true, todos };
  });

  /** Session draft input — stored on sessions.draft_input in SQLite. */
  app.get("/api/sessions/:id/draft", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const draft = getSessionDraftInput(id, dataDir);
    return { draft: draft ?? "" };
  });

  app.put("/api/sessions/:id/draft", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as { draft?: string };
    const draft = typeof body.draft === "string" ? body.draft : "";
    setSessionDraftInput(id, draft, dataDir);
    return { ok: true, draft };
  });

  /** Per-session model config — sessions.model_config_json in SQLite.
   *  Also stores a `context` key for context-range controls. */
  app.get("/api/sessions/:id/model-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    try {
      const raw = getSessionModelConfigJson(id, dataDir);
      if (!raw) return { mode: "fixed", windowSize: 10, pinnedTurn: null };
      const parsed = JSON.parse(raw);
      return parsed?.context ?? { mode: "fixed", windowSize: 10, pinnedTurn: null };
    } catch {
      return { mode: "fixed", windowSize: 10, pinnedTurn: null };
    }
  });

  app.put("/api/sessions/:id/context-config", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const body = (request.body || {}) as {
      mode?: "sliding" | "fixed";
      windowSize?: number;
      pinnedTurn?: number | null;
      autoCompactionEnabled?: boolean | null;
      autoCompactionTriggerTokens?: number | null;
      autoCompactionShowIndicator?: boolean | null;
      enabled?: boolean | null;
      summarizationModel?: string | null;
      summarizationFallbackModel?: string | null;
      summarizationPromptMd?: string | null;
      summarizeIncludePriorSummary?: boolean | null;
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
      mode: body.mode !== undefined ? body.mode : existingCtx.mode ?? "fixed",
      windowSize: body.windowSize !== undefined ? body.windowSize : existingCtx.windowSize ?? 10,
      pinnedTurn: body.pinnedTurn !== undefined ? body.pinnedTurn : existingCtx.pinnedTurn ?? null,
      autoCompactionEnabled: body.autoCompactionEnabled !== undefined ? body.autoCompactionEnabled : existingCtx.autoCompactionEnabled ?? false,
      autoCompactionTriggerTokens: body.autoCompactionTriggerTokens !== undefined ? body.autoCompactionTriggerTokens : existingCtx.autoCompactionTriggerTokens ?? 0,
      autoCompactionShowIndicator: body.autoCompactionShowIndicator !== undefined ? body.autoCompactionShowIndicator : existingCtx.autoCompactionShowIndicator ?? true,
      enabled: body.enabled !== undefined ? body.enabled : existingCtx.enabled ?? false,
      summarizationModel: body.summarizationModel !== undefined ? body.summarizationModel : existingCtx.summarizationModel ?? undefined,
      summarizationFallbackModel: body.summarizationFallbackModel !== undefined ? body.summarizationFallbackModel : existingCtx.summarizationFallbackModel ?? undefined,
      summarizationPromptMd: body.summarizationPromptMd !== undefined ? body.summarizationPromptMd : existingCtx.summarizationPromptMd ?? undefined,
      summarizeIncludePriorSummary: body.summarizeIncludePriorSummary !== undefined ? body.summarizeIncludePriorSummary : existingCtx.summarizeIncludePriorSummary ?? true,
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
      return (config.global as Record<string, unknown>) ?? { mode: "fixed", windowSize: 10, pinnedTurn: null };
    }
    if (q.scope === "project") {
      const ws = q.workspaceRoot;
      if (!ws) return { mode: "fixed", windowSize: 10, pinnedTurn: null };
      return ((config.workspaces as Record<string, unknown>)?.[ws] as Record<string, unknown>) ?? { mode: "fixed", windowSize: 10, pinnedTurn: null };
    }
    return { mode: "fixed", windowSize: 10, pinnedTurn: null };
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
      const s = await getLiveSessionMeta(dataDir, opts.sessionId);
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
    const sessionEnabled = session["enabled"] === true;
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
        o["mode"] !== undefined || o["windowSize"] !== undefined || o["pinnedTurn"] !== undefined ||
        o["autoCompactionEnabled"] !== undefined || o["autoCompactionTriggerTokens"] !== undefined || o["autoCompactionShowIndicator"] !== undefined ||
        o["summarizationModel"] !== undefined || o["summarizationFallbackModel"] !== undefined || o["summarizationPromptMd"] !== undefined ||
        o["summarizeIncludePriorSummary"] !== undefined || o["summarizationSafetyMargin"] !== undefined || o["summarizationPriorTurns"] !== undefined;
    const owner =
      (sessionEnabled && hasOwn(session)) ? "session"
      : (projectEnabled && hasOwn(project)) ? "project"
      : hasOwn(global) ? "global"
      : "none";

    // Auto compaction and manual (sliding/fixed) are MUTUALLY EXCLUSIVE.
    // When auto compaction is on it drives the boundary, so the manual mode is
    // forced to fixed and any sliding windowSize is ignored to avoid conflict.
    const autoCompactionOn = (pick("autoCompactionEnabled") as boolean | undefined) ?? false;
    const resolvedMode = autoCompactionOn ? "fixed" : ((pick("mode") as string) ?? "fixed");
    const resolvedWindowSize = (pick("windowSize") as number) ?? 10;
    const resolvedPinnedTurn = (pick("pinnedTurn") as number | null) ?? null;

    return {
      mode: resolvedMode,
      windowSize: resolvedWindowSize,
      pinnedTurn: resolvedPinnedTurn,
      autoCompactionEnabled: (pick("autoCompactionEnabled") as boolean | undefined) ?? false,
      autoCompactionTriggerTokens: (pick("autoCompactionTriggerTokens") as number | undefined) ?? 0,
      autoCompactionShowIndicator: (pick("autoCompactionShowIndicator") as boolean | undefined) ?? true,
      summarizationModel: pick("summarizationModel") as string | undefined,
      summarizationFallbackModel: pick("summarizationFallbackModel") as string | undefined,
      summarizationPromptMd: pick("summarizationPromptMd") as string | undefined,
      summarizeIncludePriorSummary: (pick("summarizeIncludePriorSummary") as boolean | undefined) ?? true,
      summarizationSafetyMargin: (pick("summarizationSafetyMargin") as number | undefined) ?? 0.2,
      summarizationPriorTurns: Math.max(0, Math.floor((pick("summarizationPriorTurns") as number | undefined) ?? 0)),
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
      includePriorSummary?: boolean; // chain prior summaries into this one
      priorTurns?: number;          // optional: raw turns before range to feed in
      initiator?: string;   // optional: who started it (slider/keyboard/context-menu/...)
    };

    const { sessionId, endTurnNum, startTurnNum, promptMd, model, fallbackModel, includePriorSummary, priorTurns, initiator } = body;
    if (!sessionId || endTurnNum == null) {
      return reply.code(400).send({ error: "sessionId and endTurnNum are required" });
    }

    const session = await getLiveSessionMeta(dataDir, sessionId);
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

    // The slider position is a live-turn boundary — fractional (summary-anchor)
    // positions are rejected; the frontend disables summarizing on those.
    if (!Number.isInteger(endTurnNum)) {
      return reply.code(400).send({ error: "endTurnNum must be an integer turn number" });
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
    const chatMessages = projectSessionChat(sessionId, dataDir) as unknown as {
      turnId: number | null; isSummary?: boolean; role: string; content: string;
    }[];
    const priorTurnsN = Math.max(0, Math.floor(priorTurns ?? eff.summarizationPriorTurns ?? 0));
    const priorCtx = extractPriorTurns(chatMessages, latestRange?.endTurn ?? null, priorTurnsN);

    // Get prior summary text if chain has a previous range. The summary text
    // lives as a `text` step_part whose `data` is `JSON.stringify({ content })`;
    // parse out `.content` (never send/show the raw JSON wrapper). Request flag
    // wins; otherwise honor the effective context config setting.
    const includePrior = includePriorSummary ?? eff.summarizeIncludePriorSummary ?? true;
    const priorSummary = includePrior && latestRange
      ? (() => {
          const raw = getDbForDataDir(dataDir)
            .select({ data: stepParts.data })
            .from(stepParts)
            .where(and(eq(stepParts.turnId, latestRange.summaryTurnId), eq(stepParts.type, "text")))
            .orderBy(stepParts.seq)
            .limit(1)
            .get()?.data ?? null;
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw);
            return typeof parsed.content === "string" && parsed.content ? parsed.content : raw;
          } catch {
            return raw;
          }
        })()
      : null;

    // Read the actual summarization prompt content (used as the user-side
    // message of the completed summary turn, so a human can see what
    // instructed it). originalTokens + summarizer messages are derived inside
    // runSummaryBlock per block, so they are not computed here.
    let promptContent = promptRef ? await readSummarizationPrompt(promptRef) : null;
    if (!promptContent) {
      promptContent = `Summarize conversation turns ${computedStartTurnNum}–${summarizedEndTurn}`;
    }

    // Recover stale in-progress summaries (crashed runs), then reject
    // concurrent generation for the same range so only one placeholder and
    // one summary row can exist per range.
    expireStaleSummaryPlaceholders(dataDir, sessionId, 5 * 60_000);
    for (const st of getPendingSummaryTurns(dataDir, sessionId)) {
      try {
        const meta = JSON.parse(st.configSnapshotJson ?? "{}") as { range?: { startTurn?: number; endTurn?: number } };
        if (meta?.range?.startTurn === computedStartTurnNum && meta?.range?.endTurn === summarizedEndTurn) {
          return reply.code(409).send({
            error: `A summary for turns ${computedStartTurnNum}–${summarizedEndTurn} is already being generated`,
          });
        }
      } catch { /* unparseable snapshot — not a match */ }
    }

    // ── Child session (created UPFRONT so the user can open it and watch the
    // summary stream live). It holds the cloned context turns + a real
    // streaming turn whose parts are written as deltas arrive. ──────────────
    const now = new Date().toISOString();
    const initiatorLabel = typeof initiator === "string" && initiator.trim() ? initiator.trim() : "manual";

    // Resolve the summarizer's own max context (R1/R10). Fail loudly when unknown.
    const maxContext = await resolveSummarizerContextLimit({
      modelRef: modelRef ?? "",
      fallbackModelRef,
      dataDir,
    });
    if (maxContext == null) {
      return reply.code(500).send({ error: `Cannot resolve summarizer context limit for "${modelRef}"` });
    }
    const budget = perBlockBudget(maxContext, eff.summarizationSafetyMargin ?? 0.2);

    // Rebuild turn groups carrying turn numbers so block boundaries map to
    // actual turn ids for chained summaryRanges rows.
    const turnGroups: { turnNumber: number; userContent: string; assistantContents: string[] }[] = [];
    {
      let curI: { turnNumber: number; userContent: string; assistantContents: string[] } | null = null;
      for (const m of chatMessages) {
        if (m.isSummary) continue;
        const tn = m.turnId;
        if (tn == null || tn < computedStartTurnNum || tn > summarizedEndTurn) continue;
        const content = m.content ?? "";
        if (!content) continue;
        if (m.role === "user") {
          if (curI) turnGroups.push(curI);
          curI = { turnNumber: tn, userContent: content, assistantContents: [] };
        } else if (m.role === "assistant") {
          if (!curI) curI = { turnNumber: tn, userContent: "", assistantContents: [] };
          curI.assistantContents.push(content);
        }
      }
      if (curI) turnGroups.push(curI);
    }
    if (turnGroups.length === 0) {
      return reply.code(400).send({ error: "Nothing to summarize in range" });
    }

    const plannerInput = turnGroups.map((g) => ({
      role: "user" as const,
      content: [g.userContent, ...g.assistantContents].filter(Boolean).join("\n"),
    }));
    let boundaries;
    try {
      boundaries = planChunks({ turns: plannerInput, prioritySummary: priorSummary, prompt: promptContent, budget, priorTurns: priorCtx.turns });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }

    let result: BlockSummaryResult | null = null;
    let prevRangeId: number | null = latestRange?.id ?? null;
    let runningPrior: string | null = priorSummary;
    try {
      for (const b of boundaries) {
        const slice = turnGroups.slice(b.startIndex, b.endIndex + 1);
        if (slice.length === 0) continue;
        const blockStartTurn = slice[0].turnNumber;
        const blockEndTurn = slice[slice.length - 1].turnNumber;
        const blockTurns: { role: "user" | "assistant"; content: string }[] = [];
        for (const g of slice) {
          blockTurns.push({ role: "user", content: g.userContent });
          for (const m of g.assistantContents) blockTurns.push({ role: "assistant", content: m });
        }
        const blockGroups = slice.map((g) => ({ userContent: g.userContent, assistantContents: g.assistantContents }));
        result = await runSummaryBlock({
          dataDir, sessionId, workspaceRoot: body.workspaceRoot,
          startTurn: blockStartTurn, endTurn: blockEndTurn,
          rangeTurns: blockTurns,
          rangeGroups: blockGroups,
          priorTurns: priorCtx.turns,
          priorTurnGroups: priorCtx.groups,
          priorSummary: runningPrior,
          priorCloneGroup: runningPrior ? { userContent: "Previous summary:", assistantContents: [runningPrior] } : null,
          prevRangeId,
          modelRef,
          fallbackModelRef,
          promptMd: promptRef,
          initiator: initiatorLabel,
        });
        prevRangeId = result.rangeId;
        runningPrior = result.summaryText;
      }
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }

    try { sendSessionStateToSession(sessionId); } catch { /* ignore */ }
    if (result) { try { sendSessionStateToSession(result.childSessionId); } catch { /* ignore */ } }

    return reply.code(201).send({
      summaryTurnId: result?.summaryTurnId ?? null,
      rangeId: result?.rangeId ?? null,
      summary: result?.summaryText ?? "",
      tokens: result?.summaryTokens ?? 0,
      created: true,
      startTurn: computedStartTurnNum,
      endTurn: summarizedEndTurn,
    });
  });

  // ── Get summary ranges for a session ────────────────────────────────────

  app.get("/api/sessions/:id/summary-ranges", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });

    const ranges = getSummaryRangesForSession(dataDir, id);
    return { ranges };
  });

  app.delete("/api/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const session = await getLiveSessionMeta(dataDir, id);
    const workspaceRoot = session?.workspaceRoot;
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
      const session = await getLiveSessionMeta(dataDir, id);
      if (!session) return { error: "not found" };
      if (session.workspaceRoot?.trim()) {
        return {
          error: "workspace is fixed for this session (set only at start)",
          session,
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
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const summaries = listTurnSummaries(id, dataDir);
    return { turns: summaries };
  });

  app.get("/api/sessions/:id/turns/:turnId", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const turn = getTurnDetail(id, numTurnId, dataDir);
    if (!turn) return reply.code(404).send({ error: "turn not found" });
    return { turn };
  });

  app.get("/api/sessions/:id/turns/:turnId/raw", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const raw = await getTurnStepRawCapture(id, numTurnId, dataDir);
    if (!raw) return { rawRequest: null, rawResponse: null, steps: [] };
    return raw;
  });

  app.get("/api/sessions/:id/turns/:turnId/reconstructed-requests", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
    if (!session) return reply.code(404).send({ error: "session not found" });
    const numTurnId = parseInt(turnId, 10);
    if (isNaN(numTurnId)) return reply.code(400).send({ error: "invalid turn id" });
    const detail = getTurnDetail(id, numTurnId, dataDir);
    if (!detail) return reply.code(404).send({ error: "turn not found" });
    return { steps: detail.steps };
  });

  app.get("/api/sessions/:id/turns/:turnId/steps/:stepIndex", async (request, reply) => {
    const { id, turnId, stepIndex } = request.params as { id: string; turnId: string; stepIndex: string };
    const session = await getLiveSessionMeta(dataDir, id);
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
    const session = await getLiveSessionMeta(dataDir, id);
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
    await setSessionLayout(dataDir, body.workspace, body.tree as import("../../../../_shared/types").LayoutNode[]);
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
