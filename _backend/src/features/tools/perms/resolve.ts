import type { PermissionMode, PermsLayer } from "../../../../../_shared/types";
import { toolsTrusted } from "../permissions";
import { ensureGlobal, readSession, readWorkspace } from "./store";

export interface ResolveContext {
  dataDir: string;
  sessionId?: string;
  workspaceRoot?: string;
}

export interface ResolvedPermission {
  mode: PermissionMode;
  /** Which layer supplied the mode; "unknown" if missing from all three files */
  source: PermsLayer | "trusted" | "unknown";
}

/**
 * Resolve tool permission from the three on-disk files only.
 *
 * Order (stop at first file that defines this tool):
 *   1. sessionPerms.json
 *   2. workspacePerms.json
 *   3. globalPerms.json  (if missing: generate from hardcoded defaults, write, re-read)
 *
 * Hardcoded defaults are never read as the live config — only used to write global.
 * VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED forces allow. Unknown after all layers → ask.
 */
export async function resolveToolPermissionDetailed(
  toolName: string,
  ctx: ResolveContext
): Promise<ResolvedPermission> {
  if (toolsTrusted()) {
    return { mode: "allow", source: "trusted" };
  }

  // 1) Session — key present → stop
  if (ctx.sessionId) {
    const session = await readSession(ctx.dataDir, ctx.sessionId);
    const mode = session.file.tools[toolName];
    if (mode !== undefined) {
      return { mode, source: "session" };
    }
  }

  // 2) Workspace — key present → stop
  if (ctx.workspaceRoot?.trim()) {
    const ws = await readWorkspace(ctx.workspaceRoot);
    const mode = ws.file.tools[toolName];
    if (mode !== undefined) {
      return { mode, source: "workspace" };
    }
  }

  // 3) Global file on disk (create from defaults if needed, then read file)
  const global = await ensureGlobal(ctx.dataDir);
  const gMode = global.tools[toolName];
  if (gMode !== undefined) {
    return { mode: gMode, source: "global" };
  }

  return { mode: "ask", source: "unknown" };
}

export async function resolveToolPermission(
  toolName: string,
  ctx: ResolveContext
): Promise<PermissionMode> {
  const r = await resolveToolPermissionDetailed(toolName, ctx);
  return r.mode;
}

/**
 * Effective mode for every tool named in any of the three disk files
 * (ensures global exists first so keys come from the written JSON).
 */
export async function resolveAllKnownTools(
  ctx: ResolveContext
): Promise<Record<string, ResolvedPermission>> {
  const names = new Set<string>();

  const g = await ensureGlobal(ctx.dataDir);
  for (const k of Object.keys(g.tools)) names.add(k);

  if (ctx.sessionId) {
    const s = await readSession(ctx.dataDir, ctx.sessionId);
    for (const k of Object.keys(s.file.tools)) names.add(k);
  }
  if (ctx.workspaceRoot?.trim()) {
    const w = await readWorkspace(ctx.workspaceRoot);
    for (const k of Object.keys(w.file.tools)) names.add(k);
  }

  const out: Record<string, ResolvedPermission> = {};
  for (const name of [...names].sort()) {
    out[name] = await resolveToolPermissionDetailed(name, ctx);
  }
  return out;
}
