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
} from "../../_shared/types";

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
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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

export function listSessions() {
  return fetchJson<SessionMeta[]>(`${BASE}/sessions`);
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
    userMessage: import("../../_shared/types").Message;
    assistantMessage: import("../../_shared/types").Message | null;
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
  return fetchJson<{ rawRequest: unknown; rawResponse: unknown }>(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}/raw`
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

export interface MdEntry {
  path: string;
  fullPath: string;
  tags: string[];
  lastEdited: string | null;
  stats?: {
    chars: number;
    words: number;
    lines: number;
    tokens: number;
  };
}

export interface MdListResult {
  entries: Record<string, MdEntry[]>;
  roots: {
    mds: string;
    workspace: string;
  };
}

export async function listMds(sessionId: string) {
  return fetchJson<MdListResult>(
    `${BASE}/mds?sessionId=${encodeURIComponent(sessionId)}`
  );
}

export async function readMd(sessionId: string, path: string) {
  return fetchJson<{ content: string }>(
    `${BASE}/mds/read?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`
  );
}

export async function createMd(sessionId: string, path: string, content: string, tags?: string[]) {
  return fetchJson<{ ok: boolean }>(`${BASE}/mds/create?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ path, content, tags }),
  });
}

export async function updateMd(sessionId: string, path: string, opts: { newPath?: string; content?: string; tags?: string[] }) {
  return fetchJson<{ ok: boolean }>(`${BASE}/mds/update?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({ path, ...opts }),
  });
}

export async function deleteMd(sessionId: string, path: string) {
  return fetchJson<{ ok: boolean }>(
    `${BASE}/mds/delete?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`,
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

export function getTurn(sessionId: string, turnId: number) {
  return fetchJson<{ turn: TurnData }>(
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

import type { SpecDocument, PlanDocument, SpecPlanPart } from "../../_shared/types";

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

export function createSpecViaApi(body: {
  name: string;
  endGoal?: string;
  goal?: string;
  scope?: string;
  workspaceRoot?: string;
  sessionId?: string;
}) {
  // Backend accepts goal; send both for compatibility.
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

export function testMcpConnection(server: import("../../_shared/types").McpServerConfig) {
  return fetchJson<{ ok: boolean; error?: string; toolCount?: number; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>(
    `${BASE}/mcp-servers/test`,
    { method: "POST", body: JSON.stringify(server) }
  );
}

export function callMcpTool(server: import("../../_shared/types").McpServerConfig, toolName: string, args: Record<string, unknown>) {
  return fetchJson<{ ok: boolean; result?: string; error?: string }>(
    `${BASE}/mcp-servers/call-tool`,
    { method: "POST", body: JSON.stringify({ server, toolName, args }) }
  );
}
