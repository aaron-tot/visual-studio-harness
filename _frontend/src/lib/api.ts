import type {
  ConfigFile,
  Session,
  SessionMeta,
  LayoutNode,
  ModelConfig,
  PermissionMode,
  PermsFile,
  TurnsFile,
  TurnData,
  AgentSettings,
  TurnStepRawDetail,
  TurnRawCapture,
  AppInfo,
  UpdateState,
} from "@shared/types";

export type { AppInfo };

const BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined && options.body !== null;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { error?: string; message?: string };
      detail = body.error || body.message || "";
    } catch {
      try { detail = await res.text(); } catch { /* ignore */ }
    }
    throw new Error(detail ? `${detail} (${res.status})` : `API error: ${res.status}`);
  }
  return res.json();
}

export function getConfig() {
  return fetchJson<ConfigFile>(`${BASE}/config`);
}

export function updateConfig(config: ConfigFile) {
  return fetchJson<{ ok: boolean }>(`${BASE}/config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export interface UpdatesInfo {
  appCommit: string;
  repoUrl: string;
  updates: UpdateState;
}

export function getUpdates() {
  return fetchJson<UpdatesInfo>(`${BASE}/updates`);
}

export function checkUpdates() {
  return fetchJson<UpdatesInfo>(`${BASE}/updates/check`, { method: "POST" });
}

export function listSessions() {
  return fetchJson<SessionMeta[]>(`${BASE}/sessions`);
}

export function getActiveSessions() {
  return fetchJson<{ sessionIds: string[] }>(`${BASE}/sessions/active`);
}

export function getSession(id: string) {
  return fetchJson<Session>(`${BASE}/sessions/${id}`);
}

export function deleteSession(id: string) {
  return fetchJson<{ ok: boolean }>(`${BASE}/sessions/${id}`, {
    method: "DELETE",
  });
}

export function renameSession(id: string, title: string) {
  return fetchJson<{ ok: boolean }>(`${BASE}/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  });
}

export function starSession(id: string, starred: boolean) {
  return fetchJson<{ ok: boolean }>(`${BASE}/sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify({ starred }),
  });
}

export function updateSessionWorkspace(id: string, workspaceRoot: string) {
  return fetchJson<{ ok: boolean; session?: SessionMeta; error?: string }>(
    `${BASE}/sessions/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ workspaceRoot }),
    }
  );
}

export function listWorkspaces() {
  return fetchJson<{ workspaces: string[] }>(`${BASE}/workspaces`);
}

export function getSessionLayout(workspaceRoot: string) {
  return fetchJson<{ workspace: string; tree: LayoutNode[] }>(
    `${BASE}/session-layout?workspace=${encodeURIComponent(workspaceRoot)}`
  );
}

export function putSessionLayout(workspaceRoot: string, tree: LayoutNode[]) {
  return fetchJson<{ ok: boolean }>(`${BASE}/session-layout`, {
    method: "PUT",
    body: JSON.stringify({ workspace: workspaceRoot, tree }),
  });
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: { name: string; path: string; isDir: boolean }[];
  error?: string;
}

export function listFs(path?: string) {
  const q = path ? `?path=${encodeURIComponent(path)}` : "";
  return fetchJson<FsListResult>(`${BASE}/fs${q}`);
}

export async function fetchProviderModels(index: number) {
  const res = await fetch(`${BASE}/providers/${index}/models`);
  const data = (await res.json().catch(() => ({}))) as {
    models?: ModelConfig[];
    error?: string;
  };
  if (!res.ok || data.error) {
    const msg = data.error || `API error: ${res.status}`;
    throw new Error(msg);
  }
  return data as { models: ModelConfig[] };
}

/** Blocking agent turn for tests/automation (full JSON, no stream). Uses config.agents. */
export function postMessage(body: {
  content: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{
    sessionId: string;
    created: boolean;
    meta: SessionMeta;
    workspaceRoot: string;
    userMessage: import("../../../_shared/types").Message;
    assistantMessage: import("../../../_shared/types").Message | null;
    error: string | null;
  }>(`${BASE}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface PermsLayerResponse {
  layer: "global" | "workspace" | "session";
  path: string;
  exists: boolean;
  tools: Record<string, PermissionMode>;
  version?: number;
  workspaceRoot?: string;
  sessionId?: string;
}

export function getGlobalPerms() {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/global`);
}

export function putGlobalPerms(tools: Record<string, PermissionMode>, version = 1) {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/global`, {
    method: "PUT",
    body: JSON.stringify({ version, tools }),
  });
}

export function resetGlobalPerms() {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/global/reset`, {
    method: "POST",
  });
}

export function getWorkspacePerms(path: string) {
  return fetchJson<PermsLayerResponse>(
    `${BASE}/perms/workspace?path=${encodeURIComponent(path)}`
  );
}

export function putWorkspacePerms(path: string, tools: Record<string, PermissionMode>, version = 1) {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/workspace`, {
    method: "PUT",
    body: JSON.stringify({ path, tools, version }),
  });
}

export function getSessionPerms(sessionId: string) {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/session/${encodeURIComponent(sessionId)}`);
}

export function putSessionPerms(
  sessionId: string,
  tools: Record<string, PermissionMode>,
  version = 1
) {
  return fetchJson<PermsLayerResponse>(`${BASE}/perms/session/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({ version, tools }),
  });
}

export function getResolvedPerms(sessionId: string) {
  return fetchJson<{
    sessionId: string;
    workspaceRoot: string | null;
    tools: Record<string, { mode: PermissionMode; source: string }>;
  }>(`${BASE}/perms/resolved?sessionId=${encodeURIComponent(sessionId)}`);
}

export const EXTERNAL_DIRECTORY_PREFIX = "external_directory:";

export type { PermsFile, PermissionMode };

export function getTurns(sessionId: string) {
  return fetchJson<{ turns: TurnsFile }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns`
  );
}

export function getTurnRaw(sessionId: string, turnId: number) {
  return fetchJson<TurnRawCapture>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}/raw`
  );
}

export function getReconstructedRequests(sessionId: string, turnId: number) {
  return fetchJson<{ sdkRequest: unknown; providerRequest: unknown }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}/reconstructed-requests`
  );
}

export function getTurnFull(sessionId: string, turnId: number) {
  return fetchJson<{ messages: import("../../../_shared/types").Message[]; parts: import("../../../_shared/types").MessagePartType[] }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}/full`
  );
}

export function getTurnSteps(sessionId: string, turnNumber: number) {
  return fetchJson<{ steps: import("../../../_shared/types/trace").StepSummary[] }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnNumber}/steps`
  );
}

export function getTurnStep(sessionId: string, turnNumber: number, stepIndex: number) {
  return fetchJson<{ step: unknown; parts: unknown[] }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnNumber}/steps/${stepIndex}`
  );
}

export function getSessionUsage(sessionId: string) {
  return fetchJson<import("../../../_shared/types/trace").SessionUsage>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/usage`
  );
}

export function getUsageTree(sessionId: string) {
  return fetchJson<import("../features/info-panel/components/usage-v2/types").UsageTreeSession>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/usage-tree`
  );
}

export async function readMd(sessionId: string, path: string) {
  return fetchJson<{ content: string }>(
    `${BASE}/mds/read?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
  );
}

export interface MdsAgentsPaths {
  globalBase: string;
  workspaceAgents: string | null;
  workspaceRoot: string | null;
}

export async function getMdsAgentsPaths(sessionId?: string, workspaceRoot?: string) {
  return fetchJson<MdsAgentsPaths>(`${BASE}/mds/agents-paths${mdsScopeQuery({ sessionId, workspaceRoot })}`);
}

export interface MdsAgentsFile {
  path: string;
  exists: boolean;
  content: string;
}

export function getMdsAgentsFile(opts: { sessionId?: string; workspaceRoot?: string }) {
  return fetchJson<MdsAgentsFile>(`${BASE}/mds/agents-file${mdsScopeQuery(opts)}`);
}

export function writeMdsAgentsFile(opts: { content: string; sessionId?: string; workspaceRoot?: string }) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/agents-file${mdsScopeQuery(opts)}`,
    { method: "PUT", body: JSON.stringify({ content: opts.content }) }
  );
}

export interface ScopeDirNode {
  name: string;
  type: "file" | "dir";
  ext: string;
  children: ScopeDirNode[];
  /** true when this dir is an MDS item folder (contains prompt.md) */
  isItem?: boolean;
}

export interface ScopeItem {
  name: string;
  relPath: string;
  path: string;
  promptPath: string;
  tags: string[];
}

export type ScopePathEntry =
  | { available: true; path: string; tree: ScopeDirNode[]; tags: string[]; items: ScopeItem[] }
  | { available: false; reason: string };

export interface ScopePathsResult {
  mode: string;
  dataDirSource: "env" | "portable" | "installed" | "dev" | "cwd";
  dataDir: string;
  workspaceRoot: string | null;
  sessionId: string | null;
  scopes: Record<"global" | "project" | "session", ScopePathEntry>;
}

export async function getMdsScopePaths(opts: { sessionId?: string; workspaceRoot?: string }) {
  const params = new URLSearchParams();
  if (opts.sessionId) params.set("sessionId", opts.sessionId);
  if (opts.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  const qs = params.toString();
  return fetchJson<ScopePathsResult>(`${BASE}/mds/scope-paths${qs ? `?${qs}` : ""}`);
}

function mdsScopeQuery(opts: { sessionId?: string; workspaceRoot?: string }): string {
  const params = new URLSearchParams();
  if (opts.sessionId) params.set("sessionId", opts.sessionId);
  if (opts.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function createMdsScopeFolder(opts: {
  scope: "global" | "project" | "session";
  name: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/scope-mkdir${mdsScopeQuery(opts)}`,
    { method: "POST", body: JSON.stringify({ scope: opts.scope, name: opts.name }) }
  );
}

export function renameMdsScopeFolder(opts: {
  scope: "global" | "project" | "session";
  from: string;
  to: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/scope-rename${mdsScopeQuery(opts)}`,
    { method: "PUT", body: JSON.stringify({ scope: opts.scope, from: opts.from, to: opts.to }) }
  );
}

export function transferMdsScopeFolder(opts: {
  fromScope: "global" | "project" | "session";
  relPath: string;
  toScope: "global" | "project" | "session";
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; fromPath: string; toPath: string }>(
    `${BASE}/mds/scope-transfer${mdsScopeQuery(opts)}`,
    { method: "POST", body: JSON.stringify({ fromScope: opts.fromScope, toScope: opts.toScope, relPath: opts.relPath }) }
  );
}

export function createMdsScopeMd(opts: {
  scope: "global" | "project" | "session";
  name: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/scope-create-md${mdsScopeQuery(opts)}`,
    { method: "POST", body: JSON.stringify({ scope: opts.scope, name: opts.name }) }
  );
}

function mdsScopeFileQuery(opts: { scope?: string; path?: string; sessionId?: string; workspaceRoot?: string }): string {
  const params = new URLSearchParams();
  if (opts.scope) params.set("scope", opts.scope);
  if (opts.path) params.set("path", opts.path);
  if (opts.sessionId) params.set("sessionId", opts.sessionId);
  if (opts.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function readMdsScopeFile(opts: {
  scope: "global" | "project" | "session";
  path: string;
  sessionId?: string;
  workspaceRoot?: string;
}): Promise<string> {
  return fetchJson<{ content: string }>(`${BASE}/mds/scope-read-file${mdsScopeFileQuery(opts)}`).then(r => r.content);
}

export function writeMdsScopeFile(opts: {
  scope: "global" | "project" | "session";
  path: string;
  content: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/scope-write-file${mdsScopeQuery(opts)}`,
    { method: "PUT", body: JSON.stringify({ scope: opts.scope, path: opts.path, content: opts.content }) }
  );
}

export function deleteMdsScopeFolder(opts: {
  scope: "global" | "project" | "session";
  path: string;
  sessionId?: string;
  workspaceRoot?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(
    `${BASE}/mds/scope-delete${mdsScopeFileQuery(opts)}`,
    { method: "DELETE" }
  );
}

export interface SessionModelConfig {
  models: Record<string, { thinkingEffort?: string }>;
}

export async function getSessionModelConfig(sessionId: string) {
  return fetchJson<SessionModelConfig>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/model-config`
  );
}

export async function putSessionModelConfig(sessionId: string, config: SessionModelConfig) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/model-config`,
    { method: "PUT", body: JSON.stringify(config) }
  );
}

export async function getSessionDraftInput(sessionId: string) {
  return fetchJson<{ draft: string }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/draft`
  );
}

export async function putSessionDraftInput(sessionId: string, draft: string) {
  return fetchJson<{ ok: boolean; draft: string }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/draft`,
    { method: "PUT", body: JSON.stringify({ draft }) }
  );
}

export interface ToolFieldInfo {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolMeta {
  name: string;
  description: string;
  permissionDefault: string;
  inputFields: ToolFieldInfo[];
  outputFields: ToolFieldInfo[];
}

export function getTools() {
  return fetchJson<{ tools: ToolMeta[] }>(`${BASE}/tools`);
}

export interface ToolConfig {
  name: string;
  description: string;
  entry: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  permissionDefault: "allow" | "ask" | "deny";
  timeouts?: {
    minMs?: number;
    maxMs?: number;
    defaultMs?: number;
    minSec?: number;
    maxSec?: number;
    defaultSec?: number;
  };
  externalAccess?: boolean;
  subagent?: {
    slotBusyPolicy?: string;
    pollIntervalSec?: number;
    waitTimeoutSec?: number;
  };
  searchProviders?: unknown[];
  skill?: {
    guide: string;
    pushMode: "soft" | "hard" | "custom";
    id?: string;
    tags?: string[];
    customPushText?: string;
  };
}

export interface ToolConfigFile {
  ok: boolean;
  kind: "builtin" | "custom";
  config: ToolConfig;
  dir: string;
}

export function getToolConfig(name: string) {
  return fetchJson<ToolConfigFile>(`${BASE}/tools/${encodeURIComponent(name)}/config`);
}

export function putToolConfig(name: string, config: ToolConfig) {
  return fetchJson<{ ok: boolean; config: ToolConfig }>(
    `${BASE}/tools/${encodeURIComponent(name)}/config`,
    { method: "PUT", body: JSON.stringify(config) }
  );
}

export function getToolEntry(name: string) {
  return fetchJson<{ ok: boolean; name: string; entry: string; code: string }>(
    `${BASE}/tools/${encodeURIComponent(name)}/entry`
  );
}

export function putToolEntry(name: string, code: string) {
  return fetchJson<{ ok: boolean; name: string; entry: string; code: string }>(
    `${BASE}/tools/${encodeURIComponent(name)}/entry`,
    { method: "PUT", body: JSON.stringify({ code }) }
  );
}

export function getToolSkill(name: string) {
  return fetchJson<{ ok: boolean; name: string; skill: string }>(
    `${BASE}/tools/${encodeURIComponent(name)}/skill`
  );
}

export function putToolSkill(name: string, skill: string) {
  return fetchJson<{ ok: boolean; name: string; skill: string }>(
    `${BASE}/tools/${encodeURIComponent(name)}/skill`,
    { method: "PUT", body: JSON.stringify({ skill }) }
  );
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  enabled: boolean;
  permissionDefault?: string;
  skillGuide?: string;
  skillPushMode?: "soft" | "hard" | "custom";
  skillCustomPushText?: string;
  skillId?: string;
}

export function getCustomTools() {
  return fetchJson<{ tools: CustomTool[] }>(`${BASE}/custom-tools`);
}

export function createCustomTool(tool: Partial<CustomTool>) {
  return fetchJson<{ ok: boolean; tool: CustomTool }>(`${BASE}/custom-tools`, { method: "POST", body: JSON.stringify(tool) });
}

export function updateCustomTool(name: string, tool: Partial<CustomTool>) {
  return fetchJson<{ ok: boolean; tool: CustomTool }>(`${BASE}/custom-tools/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(tool) });
}

export function deleteCustomTool(name: string) {
  return fetchJson<{ ok: boolean }>(`${BASE}/custom-tools/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function toggleCustomTool(name: string) {
  return fetchJson<{ ok: boolean; enabled: boolean }>(`${BASE}/custom-tools/${encodeURIComponent(name)}/toggle`, { method: "POST" });
}

export function getTurn(sessionId: string, turnId: number) {
  return fetchJson<{ turn: import("../../../_shared/types/trace").TurnDetail }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}`
  );
}

export interface AgentFile {
  key: string;
  settings: AgentSettings;
}

export function listAgents() {
  return fetchJson<AgentFile[]>(`${BASE}/agents`);
}

export function putAgent(key: string, settings: AgentSettings) {
  return fetchJson<{ ok: boolean }>(`${BASE}/agents/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function deleteAgent(key: string) {
  return fetchJson<{ ok: boolean }>(`${BASE}/agents/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

import type { SpecDocument, PlanDocument, SpecPlanPart } from "../../../_shared/types";

export type { SpecDocument, PlanDocument, SpecPlanPart };

export interface IdeaMeta {
  abandoned?: {
    reason: string;
    successor?: string;
    timestamp: string;
  };
}

export interface PlanEntry {
  name: string;
  path: string;
  files: string[];
  specs: SpecDocument[];
  plans: PlanDocument[];
  meta: IdeaMeta;
}

export function listPlans(opts?: { scope?: string; workspaceRoot?: string; sessionId?: string }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  if (opts?.sessionId) params.set("sessionId", opts.sessionId);
  const qs = params.toString();
  return fetchJson<PlanEntry[]>(`${BASE}/plans${qs ? `?${qs}` : ""}`);
}

export function listPlansBatched(opts: { scope: string; workspaceRoots?: string[]; sessionIds?: string[] }) {
  return fetchJson<Record<string, PlanEntry[]>>(`${BASE}/plans/batch`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function createSpecViaApi(body: {
  name: string;
  endGoal?: string;
  goal?: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
  /** Optional full/partial document body. Fields here override the default empty template. */
  content?: Record<string, unknown>;
}) {
  const goal = body.goal ?? body.endGoal ?? "";
  return fetchJson<{ ok: boolean; path: string; planDir: string; version: number }>(`${BASE}/plans/create-spec`, {
    method: "POST",
    body: JSON.stringify({
      name: body.name,
      goal,
      endGoal: goal,
      scope: body.scope,
      workspaceRoot: body.workspaceRoot,
      sessionId: body.sessionId,
      createdBy: "user",
      content: body.content,
    }),
  });
}

export function createPlanViaApi(body: {
  name: string;
  endGoal?: string;
  goal?: string;
  specReference?: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
  /** Optional full/partial document body. Fields here override the default empty template. */
  content?: Record<string, unknown>;
}) {
  const endGoal = body.endGoal ?? body.goal ?? "";
  return fetchJson<{ ok: boolean; path: string; planDir: string; version: number }>(`${BASE}/plans/create-plan`, {
    method: "POST",
    body: JSON.stringify({
      name: body.name,
      endGoal,
      goal: endGoal,
      specReference: body.specReference,
      scope: body.scope,
      workspaceRoot: body.workspaceRoot,
      sessionId: body.sessionId,
      createdBy: "user",
      content: body.content,
    }),
  });
}

export function abandonIdeaViaApi(body: { name: string; reason: string; successor?: string; scope?: string; workspaceRoot?: string; sessionId?: string }) {
  return fetchJson<{ ok: boolean }>(`${BASE}/plans/abandon`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function archiveIdeaViaApi(body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string }) {
  return fetchJson<{ ok: boolean }>(`${BASE}/plans/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteIdeaViaApi(body: { name: string; scope?: string; workspaceRoot?: string; sessionId?: string }) {
  return fetchJson<{ ok: boolean }>(`${BASE}/plans/delete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function moveDesignViaApi(body: {
  name: string;
  fromScope?: string;
  toScope: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; fromPath: string; toPath: string }>(`${BASE}/plans/move`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface McpConnectionStatus {
  name: string;
  transport: string;
  connected: boolean;
  error?: string;
  toolCount: number;
}

export function getMcpStatus() {
  return fetchJson<{ servers: McpConnectionStatus[] }>(`${BASE}/mcp-servers/status`);
}

export function testMcpConnection(server: import("../../../_shared/types").McpServerConfig) {
  return fetchJson<{ ok: boolean; error?: string; toolCount?: number; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>(
    `${BASE}/mcp-servers/test`,
    { method: "POST", body: JSON.stringify(server) }
  );
}

export function callMcpTool(server: import("../../../_shared/types").McpServerConfig, toolName: string, args: Record<string, unknown>) {
  return fetchJson<{ ok: boolean; result?: string; error?: string }>(
    `${BASE}/mcp-servers/call-tool`,
    { method: "POST", body: JSON.stringify({ server, toolName, args }) }
  );
}

export interface GraphStatusResponse {
  state: "idle" | "indexing" | "watching";
  fileCount: number;
  folderCount: number;
  symbolCount: number;
  languages: string[];
  lastIndexedAt: number;
  dbPath: string;
}

export interface GraphFileRecord {
  id: number;
  path: string;
  filename: string;
  extension: string;
  language: string;
  size: number;
  modifiedMs: number;
  fileHash: string;
  indexedAtMs: number;
}

export interface GraphSymbolMatch {
  symbol: {
    id: number;
    name: string;
    kind: string;
    fileId: number;
    exported: boolean;
    async: boolean;
    static: boolean;
    visibility: string;
    signature: string | null;
    startLine: number;
    endLine: number;
    structuralHash: string;
  };
  filePath: string;
  fileName: string;
}

export interface GraphImportRecord {
  module: string;
  symbols: string[];
  importType: string;
  filePath: string;
}

export interface GraphExportRecord {
  symbol: string;
  isDefault: boolean;
  filePath: string;
}

export function getGraphStatus(workspaceRoot?: string) {
  const q = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(workspaceRoot)}` : "";
  return fetchJson<GraphStatusResponse>(`${BASE}/workspace-graph/status${q}`);
}

export function triggerGraphReindex(workspaceRoot?: string) {
  const q = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(workspaceRoot)}` : "";
  return fetchJson<{ ok: boolean }>(`${BASE}/workspace-graph/reindex${q}`, { method: "POST" });
}

export function getGraphManifest(maxDepth?: number, includeFiles?: boolean, workspaceRoot?: string) {
  const params = new URLSearchParams();
  if (maxDepth !== undefined) params.set("maxDepth", String(maxDepth));
  if (includeFiles !== undefined) params.set("includeFiles", String(includeFiles));
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  const qs = params.toString();
  return fetchJson<{ manifest: string }>(`${BASE}/workspace-graph/manifest${qs ? `?${qs}` : ""}`);
}

export function getGraphFiles(folderPath?: string, workspaceRoot?: string) {
  const params = new URLSearchParams();
  if (folderPath) params.set("folderPath", folderPath);
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  const qs = params.toString();
  return fetchJson<GraphFileRecord[]>(`${BASE}/workspace-graph/files${qs ? `?${qs}` : ""}`);
}

export function getGraphSymbols(name?: string, kind?: string, workspaceRoot?: string) {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (kind) params.set("kind", kind);
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  const qs = params.toString();
  return fetchJson<GraphSymbolMatch[]>(`${BASE}/workspace-graph/symbols${qs ? `?${qs}` : ""}`);
}

export function getGraphImports(filePath: string, workspaceRoot?: string) {
  const params = new URLSearchParams();
  params.set("filePath", filePath);
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  const qs = params.toString();
  return fetchJson<GraphImportRecord[]>(`${BASE}/workspace-graph/imports?${qs}`);
}

export function getGraphExports(filePath: string, workspaceRoot?: string) {
  const params = new URLSearchParams();
  params.set("filePath", filePath);
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  const qs = params.toString();
  return fetchJson<GraphExportRecord[]>(`${BASE}/workspace-graph/exports?${qs}`);
}

// AppInfo is imported from @shared/types at the top of this file.
export function updateDocViaApi(body: {
  name: string;
  docType: "spec" | "plan";
  version: number;
  fields: Record<string, unknown>;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string; version: number }>(`${BASE}/plans/update-doc`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getAppInfo() {
  return fetchJson<AppInfo>(`${BASE}/app-info`);
}

// ── Notes ──────────────────────────────────────────────────────────

export interface NoteMeta {
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export interface NoteEntry {
  name: string;
  path: string;
  title: string;
  body: string;
  meta: NoteMeta;
}

export function listNotes(opts?: { scope?: string; workspaceRoot?: string; sessionId?: string }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  if (opts?.sessionId) params.set("sessionId", opts.sessionId);
  const qs = params.toString();
  return fetchJson<NoteEntry[]>(`${BASE}/notes${qs ? `?${qs}` : ""}`);
}

export function listNotesBatched(opts: { scope: string; workspaceRoots?: string[]; sessionIds?: string[] }) {
  return fetchJson<Record<string, NoteEntry[]>>(`${BASE}/notes/batch`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function createNoteViaApi(body: {
  name: string;
  title: string;
  body: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/notes/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateNoteViaApi(body: {
  name: string;
  title?: string;
  body?: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/notes/update`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function archiveNoteViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; archivedPath: string }>(`${BASE}/notes/archive`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteNoteViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean }>(`${BASE}/notes/delete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function moveNoteViaApi(body: {
  name: string;
  fromScope?: string;
  toScope: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; fromPath: string; toPath: string }>(`${BASE}/notes/move`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Audits ─────────────────────────────────────────────────────────

import type { AuditDocument } from "../../../_shared/types/audit";

export type { AuditDocument, AuditFinding } from "../../../_shared/types/audit";

export interface AuditEntry {
  name: string;
  path: string;
  document: AuditDocument;
}

export function listAudits(opts?: { scope?: string; workspaceRoot?: string; sessionId?: string }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  if (opts?.sessionId) params.set("sessionId", opts.sessionId);
  const qs = params.toString();
  return fetchJson<AuditEntry[]>(`${BASE}/audits${qs ? `?${qs}` : ""}`);
}

export function listAuditsBatched(opts: { scope: string; workspaceRoots?: string[]; sessionIds?: string[] }) {
  return fetchJson<Record<string, AuditEntry[]>>(`${BASE}/audits/batch`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function createAuditViaApi(body: {
  name: string;
  document: AuditDocument;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/audits/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function readAuditViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ name: string; path: string; document: AuditDocument }>(
    `${BASE}/audits/read`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function deleteAuditViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean }>(`${BASE}/audits/delete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function editAuditViaApi(body: {
  name: string;
  document: AuditDocument;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/audits/edit`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function moveAuditViaApi(body: {
  name: string;
  fromScope?: string;
  toScope: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; fromPath: string; toPath: string }>(`${BASE}/audits/move`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Audit Prompts ──────────────────────────────────────────────────

import type { AuditPrompt } from "../../../_shared/types/audit";

export interface AuditPromptEntry {
  id: string;
  path: string;
  prompt: AuditPrompt;
}

export function listAuditPrompts() {
  return fetchJson<{ prompts: AuditPromptEntry[] }>(`${BASE}/audit-prompts`);
}

export function createAuditPromptViaApi(body: {
  id: string;
  name: string;
  description?: string;
  category?: string;
  auditType?: string;
  endGoal?: string;
  templateInstructions: string;
}) {
  return fetchJson<{ ok: boolean; path: string; prompt: AuditPrompt }>(`${BASE}/audit-prompts/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function readAuditPromptViaApi(body: { id: string }) {
  return fetchJson<{ prompt: AuditPrompt; path: string }>(`${BASE}/audit-prompts/read`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function editAuditPromptViaApi(body: {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  auditType?: string;
  endGoal?: string;
  templateInstructions?: string;
}) {
  return fetchJson<{ ok: boolean; prompt: AuditPrompt; path: string }>(`${BASE}/audit-prompts/edit`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteAuditPromptViaApi(body: { id: string }) {
  return fetchJson<{ ok: boolean }>(`${BASE}/audit-prompts/delete`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

// ── Research ──────────────────────────────────────────────────────

import type { ResearchDoc } from "../../../_shared/types/research";
export type { ResearchDoc, ResearchPoint, ResearchConfidence } from "../../../_shared/types/research";

export interface ResearchEntry {
  name: string;
  path: string;
  document: ResearchDoc;
}

export function listResearch(opts?: {
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  if (opts?.sessionId) params.set("sessionId", opts.sessionId);
  const qs = params.toString();
  return fetchJson<ResearchEntry[]>(`${BASE}/research${qs ? `?${qs}` : ""}`);
}

export function listResearchBatched(opts: { scope: string; workspaceRoots?: string[]; sessionIds?: string[] }) {
  return fetchJson<Record<string, ResearchEntry[]>>(`${BASE}/research/batch`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function createResearchViaApi(body: {
  name: string;
  document: ResearchDoc;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/research/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function readResearchViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ name: string; path: string; document: ResearchDoc }>(
    `${BASE}/research/read`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function updateResearchViaApi(body: {
  name: string;
  document: ResearchDoc;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean; path: string }>(`${BASE}/research/edit`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteResearchViaApi(body: {
  name: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{ ok: boolean }>(`${BASE}/research/delete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface MasterTestResult {
  passed: boolean | null;
  exitCode: number | null;
  timestamp: string | null;
}

export function runMasterTest() {
  return fetchJson<{ ok: boolean; pid?: number; error?: string }>(
    `${BASE}/run-master-test`,
    { method: "POST" }
  );
}

export function getMasterTestResult() {
  return fetchJson<MasterTestResult>(`${BASE}/master-test-result`);
}

// ── Knowledge Base API ──────────────────────────────────────────────

export interface KnowledgeDocumentMeta {
  id: string;
  filename: string;
  filepath: string;
  title: string;
  topics: string[];
  summary: string;
  contentType: string;
  fileHash: string;
  fileSize: number;
  status: string;
  createdBy: string;
  scope: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentContent {
  id: string;
  filename: string;
  title: string;
  content: string;
  contentTruncated?: boolean;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  filename: string;
  section: string;
  content: string;
  score: number;
}

export function knowledgeSearch(query: string, opts?: { scope?: string; limit?: number; mode?: string }) {
  const params = new URLSearchParams({ query });
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.mode) params.set("mode", opts.mode);
  return fetchJson<{ results: KnowledgeSearchResult[]; hybrid: boolean; count: number }>(
    `${BASE}/knowledge/search?${params}`
  );
}

export function knowledgeListDocuments(opts?: { scope?: string; extension?: string; status?: string; createdBy?: string }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.extension) params.set("extension", opts.extension);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.createdBy) params.set("createdBy", opts.createdBy);
  return fetchJson<{ documents: KnowledgeDocumentMeta[]; count: number }>(
    `${BASE}/knowledge/documents?${params}`
  );
}

export function knowledgeOpenDocument(id: string, opts?: { scope?: string; maxChars?: number }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  if (opts?.maxChars) params.set("maxChars", String(opts.maxChars));
  return fetchJson<KnowledgeDocumentContent>(`${BASE}/knowledge/documents/${id}?${params}`);
}

export interface KnowledgeChunkEmbedding {
  chunkId: string;
  documentId: string;
  tokenCount: number;
  model?: string;
  dimensions?: number;
  embedding?: number[];
}

export function knowledgeGetEmbeddings(id: string, opts?: { scope?: string }) {
  const params = new URLSearchParams();
  if (opts?.scope) params.set("scope", opts.scope);
  return fetchJson<{ embeddings: KnowledgeChunkEmbedding[] }>(`${BASE}/knowledge/documents/${id}/embeddings?${params}`);
}

export function knowledgeCreateDocument(body: {
  filename: string;
  content: string;
  tags?: string[];
  createdBy?: string;
  scope?: string;
}) {
  return fetchJson<{ ok: boolean; document: KnowledgeDocumentMeta }>(
    `${BASE}/knowledge/documents`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function knowledgeEditDocument(id: string, body: { content: string; scope?: string }) {
  return fetchJson<{ ok: boolean; document: KnowledgeDocumentMeta }>(
    `${BASE}/knowledge/documents/${id}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

export function knowledgeDeleteDocument(id: string, body?: { scope?: string; confirmed?: boolean }) {
  return fetchJson<{ ok: boolean; deleted: boolean; documentId: string }>(
    `${BASE}/knowledge/documents/${id}`,
    { method: "DELETE", body: JSON.stringify(body ?? {}) }
  );
}

export function moveKnowledgeDocumentViaApi(body: {
  documentId: string;
  fromScope?: string;
  toScope: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  return fetchJson<{
    ok: boolean;
    documentId: string;
    filename: string;
    fromPath: string;
    toPath: string;
  }>(`${BASE}/knowledge/documents/move`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function knowledgeIngest(scope?: string) {
  return fetchJson<{ ok: boolean; added: number; updated: number; deleted: number; failed: { filename: string; error: string }[] }>(
    `${BASE}/knowledge/ingest`,
    { method: "POST", body: JSON.stringify({ scope }) }
  );
}

export interface KnowledgeGroup {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  scope: string;
  documentCount: number;
}

export function knowledgeListGroups(scope?: string) {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  return fetchJson<{ groups: KnowledgeGroup[] }>(
    `${BASE}/knowledge/groups?${params}`
  );
}

export function knowledgeCreateGroup(body: { name: string; color?: string; scope?: string }) {
  return fetchJson<{ ok: boolean; group: KnowledgeGroup }>(
    `${BASE}/knowledge/groups`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function knowledgeUpdateGroup(
  id: string,
  body: { name?: string; color?: string; sortOrder?: number; documentIds?: string[]; scope?: string }
) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/knowledge/groups/${id}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

export function knowledgeDeleteGroup(id: string, scope?: string) {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  return fetchJson<{ ok: boolean }>(
    `${BASE}/knowledge/groups/${id}?${params}`,
    { method: "DELETE" }
  );
}

export function knowledgeUploadFile(file: File, scope?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (scope) formData.append("scope", scope);
  return fetchJson<{ ok: boolean; document: KnowledgeDocumentMeta }>(
    `${BASE}/knowledge/upload`,
    { method: "POST", body: formData }
  );
}

// ── Session context config (turn range for SDK history) ──────────────

export interface SessionContextConfig {
  firstTurnNumber: number | null;
  mode: "auto" | "manual";
  maxTurns: number;
  owner?: "session" | "project" | "global" | "none";
  manualMode?: "turnsBack" | "pinned";
  manualTurnsBack?: number;
  enabled?: boolean;
  summarizationModel?: string;
  summarizationFallbackModel?: string;
  summarizationPromptMd?: string;
}

export function getSessionContextConfig(sessionId: string) {
  return fetchJson<SessionContextConfig>(`${BASE}/sessions/${sessionId}/context-config`);
}

export function putSessionContextConfig(sessionId: string, config: Partial<SessionContextConfig>) {
  return fetchJson<{ ok: boolean }>(`${BASE}/sessions/${sessionId}/context-config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

// ── Scoped context config (global / project / session) ────────────────

export function getScopedContextConfig(scope: string, opts?: { workspaceRoot?: string }) {
  const params = new URLSearchParams({ scope });
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
  return fetchJson<SessionContextConfig>(`${BASE}/context-config/scoped?${params}`);
}

// Resolve the effective context config by merging scopes server-side
// (session overrides project overrides global). This is what the actual
// context-truncation path should use, not the raw session-scoped value.
export function getEffectiveContextConfig(
  sessionId: string,
  workspaceRoot?: string,
) {
  const params = new URLSearchParams({ sessionId });
  if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
  return fetchJson<SessionContextConfig>(`${BASE}/context-config/effective?${params}`);
}

export interface SummaryRange {
  rangeId: number;
  startTurn: number;
  endTurn: number;
  prevRangeId: number | null;
  summary: string;
}

/** Create (or return existing) summary range covering turns up to endTurnNum. */
export function summarizeRange(req: {
  sessionId: string;
  workspaceRoot?: string;
  startTurnNum?: number;
  endTurnNum: number;
  promptMd?: string;
  model?: string;
  fallbackModel?: string;
  includePriorSummary?: boolean;
}) {
  return fetchJson<{
    summaryTurnId: number;
    rangeId: number;
    summary: string;
    tokens: number;
    created?: boolean;
    startTurn?: number;
    endTurn?: number;
  }>(
    `${BASE}/context-config/summarize-range`,
    { method: "POST", body: JSON.stringify(req) },
  );
}

export function listSummaryRanges(sessionId: string) {
  return fetchJson<{ ranges: SummaryRange[] }>(`${BASE}/sessions/${sessionId}/summary-ranges`);
}

export function putScopedContextConfig(scope: string, body: Partial<SessionContextConfig>, opts?: { workspaceRoot?: string }) {
  const params = new URLSearchParams({ scope });
  if (opts?.workspaceRoot) params.set("workspaceRoot", opts.workspaceRoot);
return fetchJson<{ ok: boolean }>(`${BASE}/context-config/scoped?${params}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export interface SummarizationTestRequest {
  sessionId?: string;
  workspaceRoot?: string;
  userMessage?: string;
  agentMessage?: string;
  model?: string;
  fallbackModel?: string;
  promptMd?: string;
}

/** Stream a test summarization via SSE. Calls onDelta as text chunks arrive. Returns when done. */
export async function streamSummarizationTest(
  req: SummarizationTestRequest,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/context-config/summarization-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API error: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Parse SSE events: "data: ...\n\n"
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!raw.startsWith("data:")) continue;
      const payload = raw.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload);
        if (typeof parsed?.d === "string") onDelta(parsed.d);
      } catch {
        // non-JSON data events — ignore
      }
    }
  }
}
