import { sqliteTable, text, integer, index, uniqueIndex, real } from "drizzle-orm/sqlite-core";

/**
 * Session shell — formerly data/{mode}/sessions/<id>/meta.json (+ extras).
 * Turn body lives in turns/steps/step_parts (trace schema).
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  providerName: text("provider_name"),
  modelName: text("model_name"),
  workspaceRoot: text("workspace_root"),
  kind: text("kind").notNull().default("primary"),
  parentId: text("parent_id"),
  taskLabel: text("task_label"),
  agentName: text("agent_name"),
  thinkingEffort: text("thinking_effort"),
  created: text("created").notNull(),
  updated: text("updated").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  /** Last full system prompt sent (was system.md). */
  systemPrompt: text("system_prompt"),
  /** Session todos JSON array (was todos.json). */
  todosJson: text("todos_json"),
  /** Per-session model config JSON (was modelConfig.json). */
  modelConfigJson: text("model_config_json"),
  /** Session-layer tool perms JSON (was sessionPerms.json). */
  sessionPermsJson: text("session_perms_json"),

  // Optional cached aggregates (SoT = SUM of steps via turns)
  cachedInputTokens: integer("cached_input_tokens"),
  cachedOutputTokens: integer("cached_output_tokens"),
  cachedTotalTokens: integer("cached_total_tokens"),
  cachedTurnCount: integer("cached_turn_count"),
});

// ── Session-list layouts (per-workspace ordered dividers + sessions) ──

export const sessionLayouts = sqliteTable("session_layouts", {
  workspaceRoot: text("workspace_root").primaryKey(),
  /** JSON tree of LayoutNode[] (recursive group/session tree). */
  itemsJson: text("items_json").notNull(),
  updated: text("updated").notNull(),
});

// ── Prompt snapshots (content-hash dedup) ──────────────────────────────

export const promptSnapshots = sqliteTable("prompt_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentHash: text("content_hash").notNull().unique(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

// ── Tools snapshots (content-hash dedup) ───────────────────────────────

export const toolsSnapshots = sqliteTable("tools_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contentHash: text("content_hash").notNull().unique(),
  toolsJson: text("tools_json").notNull(),
  toolNamesJson: text("tool_names_json"),
  createdAt: text("created_at").notNull(),
});

// ── Turns ──────────────────────────────────────────────────────────────

export const turns = sqliteTable("turns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  turnNumber: integer("turn_number").notNull(),

  // User side (single storage of user text)
  userContent: text("user_content").notNull(),
  userTimestamp: text("user_timestamp").notNull(),

  // Lifecycle
  status: text("status").notNull().default("pending"),
  success: integer("success", { mode: "boolean" }),

  // Runtime meta for this attempt
  agentName: text("agent_name"),
  modelName: text("model_name"),
  providerName: text("provider_name"),
  maxSteps: integer("max_steps"),
  temperature: real("temperature"),
  thinkingEffort: text("thinking_effort"),

  // What was sent (refs)
  systemPromptSnapshotId: integer("system_prompt_snapshot_id")
    .references(() => promptSnapshots.id),
  toolsSnapshotId: integer("tools_snapshot_id")
    .references(() => toolsSnapshots.id),

  // Outcome
  finishReason: text("finish_reason"),
  errorMessage: text("error_message"),
  errorRaw: text("error_raw"),
  errorIsCustom: integer("error_is_custom", { mode: "boolean" }),
  durationMs: integer("duration_ms"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),

  // Cached usage = SUM(steps.*) after finalize
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  stepCount: integer("step_count"),

  // Opaque debug blobs
  rawRequestJson: text("raw_request_json"),
  rawResponseJson: text("raw_response_json"),
}, (t) => ({
  sessionTurnUq: uniqueIndex("uq_turns_session_number").on(t.sessionId, t.turnNumber),
  sessionIdx: index("idx_turns_session_id").on(t.sessionId),
  sessionStatusIdx: index("idx_turns_session_status").on(t.sessionId, t.status),
}));

// ── Turn context (ordered references to prior turns) ───────────────────

export const turnContext = sqliteTable("turn_context", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  turnId: integer("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  contextTurnId: integer("context_turn_id").notNull().references(() => turns.id),
  position: integer("position").notNull(),
}, (t) => ({
  turnPosUq: uniqueIndex("uq_turn_context_pos").on(t.turnId, t.position),
  turnIdx: index("idx_turn_context_turn_id").on(t.turnId),
  contextIdx: index("idx_turn_context_context_turn_id").on(t.contextTurnId),
}));

// ── Steps ──────────────────────────────────────────────────────────────

export const steps = sqliteTable("steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  turnId: integer("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),

  status: text("status").notNull().default("pending"),

  // Model identity for this completion
  providerName: text("provider_name"),
  modelId: text("model_id"),
  callId: text("call_id"),
  responseId: text("response_id"),
  responseModelId: text("response_model_id"),

  finishReason: text("finish_reason"),
  rawFinishReason: text("raw_finish_reason"),

  // Usage columns
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  cacheReadTokens: integer("cache_read_tokens"),
  cacheWriteTokens: integer("cache_write_tokens"),
  noCacheInputTokens: integer("no_cache_input_tokens"),
  usageRawJson: text("usage_raw_json"),

  // Performance columns
  stepTimeMs: integer("step_time_ms"),
  responseTimeMs: integer("response_time_ms"),
  timeToFirstOutputMs: integer("time_to_first_output_ms"),
  effectiveOutputTps: real("effective_output_tps"),
  outputTps: real("output_tps"),
  inputTps: real("input_tps"),
  toolExecutionMsJson: text("tool_execution_ms_json"),
  performanceJson: text("performance_json"),

  providerMetadataJson: text("provider_metadata_json"),
  warningsJson: text("warnings_json"),
  requestMetaJson: text("request_meta_json"),

  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (t) => ({
  turnStepUq: uniqueIndex("uq_steps_turn_index").on(t.turnId, t.stepIndex),
  turnIdx: index("idx_steps_turn_id").on(t.turnId),
  sessionIdx: index("idx_steps_session_id").on(t.sessionId),
}));

// ── Step parts ─────────────────────────────────────────────────────────

export const stepParts = sqliteTable("step_parts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  turnId: integer("turn_id").notNull(),
  stepId: integer("step_id").notNull().references(() => steps.id, { onDelete: "cascade" }),

  type: text("type").notNull(),
  seq: integer("seq").notNull(),
  status: text("status"),

  // Tool call linking
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  parentToolCallId: text("parent_tool_call_id"),

  // Type-specific payload JSON
  data: text("data").notNull(),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (t) => ({
  stepSeqIdx: index("idx_step_parts_step_seq").on(t.stepId, t.seq),
  turnSeqIdx: index("idx_step_parts_turn_seq").on(t.turnId, t.seq),
  sessionIdx: index("idx_step_parts_session_id").on(t.sessionId),
  toolCallIdx: index("idx_step_parts_tool_call_id").on(t.toolCallId),
}));

// ── Events (unchanged, retained) ───────────────────────────────────────

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  turnId: integer("turn_id").notNull(),
  type: text("type").notNull(),
  data: text("data").notNull(),
  seq: integer("seq").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  sessionTurnIdx: index("idx_events_session_turn").on(t.sessionId, t.turnId),
}));

// ── Subagent spawn edges ────────────────────────────────────────────

export const subagentSpawns = sqliteTable("subagent_spawns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentSessionId: text("parent_session_id").notNull(),
  parentTurnId: integer("parent_turn_id").notNull(),
  parentTurnNumber: integer("parent_turn_number").notNull(),
  parentStepId: integer("parent_step_id").notNull(),
  parentStepIndex: integer("parent_step_index").notNull(),
  /** Unique — one edge per parent task tool call (idempotent upsert). */
  toolCallId: text("tool_call_id").notNull(),
  childSessionId: text("child_session_id").notNull(),
  childTurnId: integer("child_turn_id"),
  childTurnNumber: integer("child_turn_number"),
  kind: text("kind").notNull(),
  taskLabel: text("task_label"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  parentSessionTurnIdx: index("idx_spawns_parent_session_turn").on(t.parentSessionId, t.parentTurnNumber),
  childSessionIdx: index("idx_spawns_child_session_id").on(t.childSessionId),
  toolCallUq: uniqueIndex("uq_spawns_tool_call_id").on(t.toolCallId),
}));

// ── Old tables removed in Phase 6 ─────────────────────────────────────
// messages and parts tables were dropped; trace schema (turns/steps/step_parts) is the SoT.
