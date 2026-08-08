import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readToolConfig } from "../../config/tool-config";
import { schemaToZod } from "../custom-tools/store";
import { classifyPath, resolveWorkspacePath, SandboxError } from "./sandbox";
import { resolveAccessiblePath } from "./path-access";
import { formatNumberedLines, truncateText } from "./format";
import type { BaseToolContext, ToolDef, ToolResult } from "./types";
import type { ToolConfig } from "../../../../_shared/types";

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
  };
  return extensions ? Object.assign(ctx, extensions) : ctx;
}

type EntryExecute = (args: unknown, ctx: unknown) => Promise<unknown>;

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
