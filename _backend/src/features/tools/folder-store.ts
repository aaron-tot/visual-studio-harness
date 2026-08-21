import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readToolConfig } from "../../config/tool-config";
import { schemaToZod } from "../custom-tools/store";
import { classifyPath, resolveWorkspacePath, SandboxError } from "./sandbox";
import { resolveAccessiblePath } from "./path-access";
import {
  DEFAULT_GREP_MAX_MATCHES,
  clipLine,
  countOccurrences,
  formatNumberedLines,
  truncateText,
} from "./format";
import { atomicWriteFile } from "./host/atomic-write";
import { applyPatchText } from "./host/patch";
import { findClosestMatch, formatSuggestion } from "./host/fuzzy-match";
import { runFd } from "./host/fd";
import { runRipgrep } from "./host/ripgrep";
import { findSymbols, readSymbolRange } from "./host/symbols";
import { runInPersistentBash } from "./host/pty-session";
import {
  SearchProviderRegistry,
  getSearchProviderRegistry,
} from "./host/search-provider-registry";
import {
  resolveNotesDir,
  allPossibleNotesDirs,
  findNoteDirByName,
  findNoteScope,
  listNotes,
  createNote,
  updateNote,
  archiveNote,
  moveNote,
  type NotesScope,
  type NoteEntry,
  type CreateNoteParams,
  type UpdateNoteParams,
  type ArchiveNoteParams,
} from "../../rest/notes";
import {
  resolveAuditsDir,
  readAuditDocument,
  listAudits,
  createAudit,
  findAuditScope,
  editAudit,
  deleteAudit,
  moveAudit,
  type AuditScope,
  type AuditEntry,
  type CreateAuditParams,
} from "../../rest/audits";
import {
  resolveAuditPromptsDir,
  readPromptFile,
  seedPromptsIfNeeded,
  listPromptEntries,
  createPrompt,
  readPrompt,
  editPrompt,
  deletePrompt,
  type AuditPromptEntry,
  type CreatePromptParams,
} from "../../rest/audit-prompts";
import type { AuditPrompt } from "../../../../_shared/types/audit";
import {
  resolveDesignsDir,
  createSpecDocument,
  createPlanDocument,
  listDesigns,
  findDesignScope,
  moveDesign,
  type DesignsScope,
  type DesignEntry,
  type CreateSpecParams,
  type CreatePlanParams,
} from "../../rest/plans";
import { listAgents, type AgentFile } from "../agents/rest";
import { KnowledgeBaseService } from "../knowledge-base/knowledge-base-service";
import { openDocumentByIdOrFilename } from "../knowledge-base/service-queries";
import { AGENT_FILENAME_PREFIX } from "../knowledge-base/constants";
import type { KbScope } from "../knowledge-base/db";
import { getLiveSessionMeta } from "../../storage/session";
import { getSessionTodosJson, setSessionTodosJson } from "../sessions/db";
import { localISOString } from "../../utils/datetime";
import { customToolToToolDef, loadCustomToolDefs } from "../custom-tools/store";
import {
  createShell,
  listShells,
  getShellOutput,
  getShellForSession,
  writeToShell,
  resizeShell,
  closeShell,
  closeAllShellsForSession,
} from "../shared-shell/manager";
import type { BaseToolContext, ToolDef, ToolResult } from "./types";
import type { SearchProviderConfig, ToolConfig, ToolSettings } from "../../../../_shared/types";

export type ToolFolderKind = "builtin" | "custom";

/** A discovered tool folder under `data/tools/{builtin,custom}/<name>/`. */
export interface ToolFolder {
  kind: ToolFolderKind;
  name: string;
  dir: string;
  config: ToolConfig;
  entryPath: string;
}

const GROUP_DIRS: Array<{ kind: ToolFolderKind; dir: string }> = [
  { kind: "builtin", dir: "builtin" },
  { kind: "custom", dir: "custom" },
];

/**
 * Scan `data/tools/{builtin,custom}/*` and return a ToolFolder per subdirectory
 * that has a readable `<name>.json`. Returns [] when `data/tools/` is missing.
 * Unreadable subdirs (no/invalid `<name>.json`) are skipped gracefully.
 */
export async function listToolFolders(dataDir: string): Promise<ToolFolder[]> {
  const root = join(dataDir, "tools");
  if (!existsSync(root)) return [];

  const folders: ToolFolder[] = [];
  for (const group of GROUP_DIRS) {
    const groupDir = join(root, group.dir);
    if (!existsSync(groupDir)) continue;

    let entries;
    try {
      entries = await readdir(groupDir, { withFileTypes: true });
    } catch {
      continue; // unreadable group dir — skip
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const dir = join(groupDir, name);
      let config: ToolConfig;
      try {
        config = await readToolConfig(join(dir, `${name}.json`));
      } catch {
        continue; // no valid <name>.json — skip
      }
      folders.push({
        kind: group.kind,
        name,
        dir,
        config,
        entryPath: join(dir, config.entry),
      });
    }
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Dynamic-import the tool's entry file and return its `execute` function.
 * Accepts three export shapes: named `execute`, default function, or `{ tool: { execute } }`.
 */
export async function loadToolEntry(
  folder: ToolFolder
): Promise<{ execute: (args: unknown, ctx: unknown) => Promise<unknown> }> {
  const url = pathToFileURL(folder.entryPath).href;
  const mod = (await import(url)) as {
    execute?: unknown;
    default?: unknown;
    tool?: { execute?: unknown };
  };
  const execute = resolveEntryExecute(mod, folder.entryPath);
  return { execute };
}

function resolveEntryExecute(
  mod: { execute?: unknown; default?: unknown; tool?: { execute?: unknown } },
  entryPath: string
): (args: unknown, ctx: unknown) => Promise<unknown> {
  if (typeof mod.execute === "function") return mod.execute as never;
  if (typeof mod.default === "function") return mod.default as never;
  if (mod.tool && typeof mod.tool.execute === "function") return mod.tool.execute as never;
  throw new Error(
    `Tool entry ${entryPath} does not export an \`execute\` function (checked module.execute, module.default, module.tool.execute)`
  );
}

/**
 * Services exposed to tool entries via `ctx.services`.
 * `dataDir`-bound: every function that needs the runtime data dir already
 * has it injected, so entries (which cannot import harness internals) never
 * pass it themselves.
 */
export interface ToolServices {
  // ── notes ──────────────────────────────────────────────────────────
  resolveNotesDir: (
    scope: NotesScope | undefined,
    workspaceRoot?: string,
    sessionId?: string
  ) => string | null;
  allPossibleNotesDirs: (sessionId?: string, workspaceRoot?: string) => string[];
  findNoteDirByName: (name: string, sessionId?: string, workspaceRoot?: string) => Promise<string | null>;
  listNotes: (
    scope?: NotesScope,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<NoteEntry[]>;
  createNote: (params: Omit<CreateNoteParams, "dataDir">) => Promise<{ path: string }>;
  updateNote: (params: Omit<UpdateNoteParams, "dataDir">) => Promise<{ path: string }>;
  archiveNote: (params: Omit<ArchiveNoteParams, "dataDir">) => Promise<{ archivedPath: string }>;
  findNoteScope: (
    name: string,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<import("../../rest/notes").NotesScope | null>;
  moveNote: (
    params: Omit<import("../../rest/notes").MoveNoteParams, "dataDir">
  ) => Promise<{ fromPath: string; toPath: string }>;

  // ── audits ─────────────────────────────────────────────────────────
  resolveAuditsDir: (
    scope: AuditScope | undefined,
    workspaceRoot?: string,
    sessionId?: string
  ) => string | null;
  readAuditDocument: typeof readAuditDocument;
  listAudits: (
    scope?: AuditScope,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<AuditEntry[]>;
  createAudit: (params: Omit<CreateAuditParams, "dataDir">) => Promise<{ path: string }>;
  findAuditScope: (
    name: string,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<AuditScope | null>;
  editAudit: (
    params: Omit<CreateAuditParams, "dataDir">
  ) => Promise<{ path: string; scope: AuditScope }>;
  deleteAudit: (
    name: string,
    scope?: AuditScope,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<void>;
  moveAudit: (
    params: Omit<import("../../rest/audits").MoveAuditParams, "dataDir">
  ) => Promise<{ fromPath: string; toPath: string; scope: import("../../rest/audits").AuditScope }>;

  // ── audit prompts ──────────────────────────────────────────────────
  createPrompt: (
    params: CreatePromptParams
  ) => Promise<{ prompt: AuditPrompt; path: string }>;
  editPrompt: (
    id: string,
    updates: Parameters<typeof editPrompt>[2]
  ) => Promise<{ prompt: AuditPrompt; path: string } | null>;
  deletePrompt: (id: string) => Promise<boolean>;
  readPrompt: (id: string) => Promise<{ prompt: AuditPrompt; path: string } | null>;
  readPromptFile: typeof readPromptFile;
  listPromptEntries: () => Promise<AuditPromptEntry[]>;
  resolveAuditPromptsDir: () => string;
  seedPromptsIfNeeded: () => Promise<void>;

  // ── plans ──────────────────────────────────────────────────────────
  createSpecDocument: (
    params: Omit<CreateSpecParams, "dataDir">
  ) => Promise<{ path: string; planDir: string; version: number }>;
  createPlanDocument: (
    params: Omit<CreatePlanParams, "dataDir">
  ) => Promise<{ path: string; planDir: string; version: number }>;
  listDesigns: (
    scope?: DesignsScope,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<DesignEntry[]>;
  resolveDesignsDir: (
    scope: DesignsScope | undefined,
    workspaceRoot?: string,
    sessionId?: string
  ) => string | null;
  findDesignScope: (
    name: string,
    workspaceRoot?: string,
    sessionId?: string
  ) => Promise<import("../../rest/plans").DesignsScope | null>;
  moveDesign: (
    params: Omit<import("../../rest/plans").MoveDesignParams, "dataDir">
  ) => Promise<{ fromPath: string; toPath: string }>;

  // ── agents ─────────────────────────────────────────────────────────
  listAgents: () => Promise<AgentFile[]>;

  // ── knowledge base ─────────────────────────────────────────────────
  KnowledgeBaseService: typeof KnowledgeBaseService;
  openDocumentByIdOrFilename: (
    scope: KbScope,
    idOrFilename: string,
    maxChars?: number,
    workspaceRoot?: string,
    sessionId?: string
  ) => ReturnType<typeof openDocumentByIdOrFilename>;
  AGENT_FILENAME_PREFIX: string;

  // ── storage / sessions ─────────────────────────────────────────────
  getLiveSessionMeta: (id: string) => ReturnType<typeof getLiveSessionMeta>;
  getSessionTodosJson: (id: string) => string | null;
  setSessionTodosJson: (id: string, todosJson: string) => void;

  // ── shared-shell ───────────────────────────────────────────────────
  /** Manage the session's interactive shells (shared-shell feature). All
   *  operations are session-scoped; a shell id is only usable when it belongs
   *  to the given session. */
  sharedShell: {
    create: (sessionId: string, opts?: { name?: string; cwd?: string }) => Promise<import("../shared-shell/types").Shell>;
    list: (sessionId: string) => import("../shared-shell/types").Shell[];
    getOutput: (id: string) => Promise<string>;
    findForSession: (sessionId: string, id: string) => import("../shared-shell/types").Shell | undefined;
    write: (id: string, data: string) => void;
    resize: (id: string, cols: number, rows: number) => void;
    close: (id: string) => void;
    closeAllForSession: (sessionId: string) => void;
  };
}

/** The harness-provided `ctx` passed to every folder tool entry. */
export interface ToolCtx extends BaseToolContext {
  toolName: string;
  /** Sandbox / path helpers. */
  SandboxError: typeof SandboxError;
  classifyPath: (userPath: string) => ReturnType<typeof classifyPath>;
  resolveWorkspacePath: (userPath: string) => string;
  resolveAccessiblePath: (userPath: string) => Promise<string>;
  /** Formatting helpers. */
  formatNumberedLines: typeof formatNumberedLines;
  truncateText: typeof truncateText;
  /** Host helpers (kept flat so entries don't have to dig into namespaces). */
  atomicWriteFile: typeof atomicWriteFile;
  applyPatchText: typeof applyPatchText;
  findClosestMatch: typeof findClosestMatch;
  formatSuggestion: typeof formatSuggestion;
  runFd: typeof runFd;
  runRipgrep: typeof runRipgrep;
  findSymbols: typeof findSymbols;
  readSymbolRange: typeof readSymbolRange;
  runInPersistentBash: (opts: {
    cwd: string;
    command: string;
    timeoutMs: number;
  }) => Promise<{ output: string; exitCode: number | null }>;
  getSearchProviderRegistry: typeof getSearchProviderRegistry;
  /** Build a fresh SearchProviderRegistry from a provider list (for per-tool searchProviders). */
  newSearchProviderRegistry: (providers: SearchProviderConfig[]) => SearchProviderRegistry;
  /** Per-tool settings injected from the tool's own `<name>.json`. */
  externalAccess?: boolean;
  searchProviders?: SearchProviderConfig[];
  /** Format constants/helpers. */
  DEFAULT_GREP_MAX_MATCHES: number;
  clipLine: typeof clipLine;
  countOccurrences: typeof countOccurrences;
  /** Datetime helper. */
  localISOString: typeof localISOString;
  /** Custom-tools store helpers. */
  customToolToToolDef: typeof customToolToToolDef;
  loadCustomToolDefs: typeof loadCustomToolDefs;
  /** Rest / knowledge / storage services (dataDir-bound). */
  services: ToolServices;
  /**
   * Extension points for later tasks (todo store, skill roots, subagent bridges).
   * Kept optional so they can be wired without circular imports.
   */
  todoStore?: unknown;
  skillRoots?: string[];
  subagent?: unknown;
}

/**
 * Build the harness `ctx` for a tool entry from the runtime BaseToolContext.
 * The tool's own name is stamped onto the ctx so sandbox/path helpers can
 * resolve per-tool external-directory permissions.
 */
export function resolveToolCtx(
  baseCtx: BaseToolContext,
  toolName: string,
  extensions?: Partial<ToolCtx>
): ToolCtx {
  // Audit prompts live under a dataDir-derived directory; bind it once.
  const promptsDir = () => resolveAuditPromptsDir(baseCtx.dataDir);
  const ctx: ToolCtx = {
    ...baseCtx,
    toolName,
    SandboxError,
    classifyPath: (userPath: string) => classifyPath(baseCtx.workspaceRoot, userPath),
    resolveWorkspacePath: (userPath: string) =>
      resolveWorkspacePath(baseCtx.workspaceRoot, userPath),
    resolveAccessiblePath: (userPath: string) =>
      resolveAccessiblePath({ ...baseCtx, toolName }, userPath),
    formatNumberedLines,
    truncateText,
    // ── host helpers (flat) ──────────────────────────────────────────
    atomicWriteFile,
    applyPatchText,
    findClosestMatch,
    formatSuggestion,
    runFd,
    runRipgrep,
    findSymbols,
    readSymbolRange,
    runInPersistentBash: (opts) =>
      runInPersistentBash({
        ...opts,
        sessionId: baseCtx.sessionId,
        abortSignal: baseCtx.abortSignal,
      }),
    getSearchProviderRegistry,
    newSearchProviderRegistry: (providers) => {
      const reg = new SearchProviderRegistry();
      reg.setAll(providers);
      return reg;
    },
    // ── format constants/helpers ─────────────────────────────────────
    DEFAULT_GREP_MAX_MATCHES,
    clipLine,
    countOccurrences,
    localISOString,
    customToolToToolDef,
    loadCustomToolDefs,
    // ── services (dataDir-bound) ─────────────────────────────────────
    services: {
      // notes
      resolveNotesDir: (scope, workspaceRoot, sessionId) =>
        resolveNotesDir(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      allPossibleNotesDirs: (sessionId, workspaceRoot) =>
        allPossibleNotesDirs(baseCtx.dataDir, sessionId, workspaceRoot),
      findNoteDirByName: (name, sessionId, workspaceRoot) =>
        findNoteDirByName(baseCtx.dataDir, name, sessionId, workspaceRoot),
      listNotes: (scope, workspaceRoot, sessionId) =>
        listNotes(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      createNote: (params) => createNote({ ...params, dataDir: baseCtx.dataDir }),
      updateNote: (params) => updateNote({ ...params, dataDir: baseCtx.dataDir }),
      archiveNote: (params) => archiveNote({ ...params, dataDir: baseCtx.dataDir }),
      findNoteScope: (name, workspaceRoot, sessionId) =>
        findNoteScope(name, baseCtx.dataDir, workspaceRoot, sessionId),
      moveNote: (params) => moveNote({ ...params, dataDir: baseCtx.dataDir }),
      // audits
      resolveAuditsDir: (scope, workspaceRoot, sessionId) =>
        resolveAuditsDir(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      readAuditDocument,
      listAudits: (scope, workspaceRoot, sessionId) =>
        listAudits(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      createAudit: (params) => createAudit({ ...params, dataDir: baseCtx.dataDir }),
      findAuditScope: (name, workspaceRoot, sessionId) =>
        findAuditScope(name, baseCtx.dataDir, workspaceRoot, sessionId),
      editAudit: (params) => editAudit({ ...params, dataDir: baseCtx.dataDir }),
      deleteAudit: (name, scope, workspaceRoot, sessionId) =>
        deleteAudit(name, baseCtx.dataDir, scope, workspaceRoot, sessionId),
      moveAudit: (params) => moveAudit({ ...params, dataDir: baseCtx.dataDir }),
      // audit prompts
      createPrompt: (params) => createPrompt(promptsDir(), params),
      editPrompt: (id, updates) => editPrompt(promptsDir(), id, updates),
      deletePrompt: (id) => deletePrompt(promptsDir(), id),
      readPrompt: (id) => readPrompt(promptsDir(), id),
      readPromptFile,
      listPromptEntries: () => listPromptEntries(promptsDir()),
      resolveAuditPromptsDir: promptsDir,
      seedPromptsIfNeeded: () => seedPromptsIfNeeded(promptsDir()),
      // plans
      createSpecDocument: (params) =>
        createSpecDocument({ ...params, dataDir: baseCtx.dataDir }),
      createPlanDocument: (params) =>
        createPlanDocument({ ...params, dataDir: baseCtx.dataDir }),
      listDesigns: (scope, workspaceRoot, sessionId) =>
        listDesigns(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      resolveDesignsDir: (scope, workspaceRoot, sessionId) =>
        resolveDesignsDir(baseCtx.dataDir, scope, workspaceRoot, sessionId),
      findDesignScope: (name, workspaceRoot, sessionId) =>
        findDesignScope(name, baseCtx.dataDir, workspaceRoot, sessionId),
      moveDesign: (params) => moveDesign({ ...params, dataDir: baseCtx.dataDir }),
      // agents
      listAgents: () => listAgents(baseCtx.dataDir),
      // knowledge base
      KnowledgeBaseService,
      openDocumentByIdOrFilename: (scope, idOrFilename, maxChars, workspaceRoot, sessionId) =>
        openDocumentByIdOrFilename(
          baseCtx.dataDir,
          scope,
          idOrFilename,
          maxChars,
          workspaceRoot,
          sessionId
        ),
      AGENT_FILENAME_PREFIX,
      // storage / sessions
      getLiveSessionMeta: (id) => getLiveSessionMeta(baseCtx.dataDir, id),
      getSessionTodosJson: (id) => getSessionTodosJson(id, baseCtx.dataDir),
      setSessionTodosJson: (id, todosJson) =>
        setSessionTodosJson(id, todosJson, baseCtx.dataDir),
      // shared-shell (session-scoped interactive shells)
      sharedShell: {
        create: (sessionId, opts) => createShell({ sessionId, name: opts?.name, cwd: opts?.cwd }),
        list: (sessionId) => listShells(sessionId),
        getOutput: (id) => getShellOutput(id),
        findForSession: (sessionId, id) => getShellForSession(sessionId, id),
        write: (id, data) => writeToShell(id, data),
        resize: (id, cols, rows) => resizeShell(id, cols, rows),
        close: (id) => closeShell(id),
        closeAllForSession: (sessionId) => closeAllShellsForSession(sessionId),
      },
    },
  };
  return extensions ? Object.assign(ctx, extensions) : ctx;
}

type EntryExecute = (args: unknown, ctx: unknown) => Promise<unknown>;

/**
 * Map a tool's own name to the `ToolSettings` key its entry reads from the ctx.
 * bash reads `ctx.toolSettings?.bash`; searchOnline/webfetch read `?.webFetch`.
 */
const TOOL_SETTINGS_KEY_BY_TOOL_NAME: Record<string, keyof ToolSettings> = {
  bash: "bash",
  searchOnline: "webFetch",
  webfetch: "webFetch",
};

/**
 * Convert a ToolConfig's `timeouts` into a `ToolSettings`-compatible object
 * keyed by the tool name, so each entry reads its OWN folder's settings via
 * `ctx.toolSettings?.<key>`. Returns undefined when the tool has no timeouts
 * or no known settings key.
 */
export function toolSettingsFromConfig(config: ToolConfig): ToolSettings | undefined {
  const key = TOOL_SETTINGS_KEY_BY_TOOL_NAME[config.name];
  const t = config.timeouts;
  if (!key || !t) return undefined;
  if (key === "bash") {
    return {
      bash: {
        timeoutMinMs: t.minMs,
        timeoutMaxMs: t.maxMs,
        timeoutDefaultMs: t.defaultMs,
      },
    };
  }
  return {
    webFetch: {
      timeoutMinSec: t.minSec,
      timeoutMaxSec: t.maxSec,
      timeoutDefaultSec: t.defaultSec,
    },
  };
}

/**
 * Stamp the tool's own per-tool settings onto the ctx from its `<name>.json`.
 * Folder settings are authoritative over any config.json-level values the
 * runtime may still thread in.
 */
export function applyToolConfigSettings(ctx: ToolCtx, config: ToolConfig): void {
  const ts = toolSettingsFromConfig(config);
  if (ts) ctx.toolSettings = { ...(ctx.toolSettings ?? {}), ...ts };
  if (config.externalAccess !== undefined) ctx.externalAccess = config.externalAccess;
  if (config.searchProviders?.length) ctx.searchProviders = config.searchProviders;
  if (config.subagent) ctx.subagent = config.subagent;
}

/** Convert a folder + entry into a ToolDef whose execute bridges to the ctx model. */
export function folderToToolDef(
  folder: ToolFolder,
  execute: EntryExecute
): ToolDef {
  return {
    name: folder.config.name,
    description: folder.config.description,
    inputSchema: schemaToZod(folder.config.inputSchema),
    permissionDefault: folder.config.permissionDefault,
    execute: async (args: unknown, baseCtx: BaseToolContext): Promise<ToolResult> => {
      const ctx = resolveToolCtx(baseCtx, folder.config.name);
      applyToolConfigSettings(ctx, folder.config);
      try {
        return normalizeToolResult(folder.config.name, await execute(args, ctx));
      } catch (err) {
        return {
          title: folder.config.name,
          output: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

/** Normalize an entry result (string | object | anything) to a ToolResult. */
export function normalizeToolResult(name: string, result: unknown): ToolResult {
  if (typeof result === "string") return { title: name, output: result };
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const out: ToolResult = {
      title: typeof r.title === "string" ? r.title : name,
      output: typeof r.output === "string" ? r.output : String(r.output ?? ""),
    };
    if (r.isError === true) out.isError = true;
    if (r._stopTurn === true) out._stopTurn = true;
    if (r.metadata && typeof r.metadata === "object") {
      out.metadata = r.metadata as Record<string, unknown>;
    }
    return out;
  }
  return { title: name, output: String(result ?? "") };
}

/**
 * Load every enabled tool from the data folders as a ToolDef.
 * Tools whose config disables them or whose entry fails to load are skipped.
 */
export async function loadToolsFromFolders(dataDir: string): Promise<ToolDef[]> {
  const folders = await listToolFolders(dataDir);
  const defs: ToolDef[] = [];
  for (const folder of folders) {
    if (!folder.config.enabled) continue;
    try {
      const entry = await loadToolEntry(folder);
      defs.push(folderToToolDef(folder, entry.execute));
    } catch (err) {
      // A broken entry shouldn't take down the whole registry — skip + report.
      console.error(
        `[folder-store] skipping tool '${folder.name}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return defs;
}
