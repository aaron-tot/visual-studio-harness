/**
 * Default permission generation from registered ToolDef[].
 *
 * Single source of truth: each tool's permissionDefault field.
 * Used to WRITE {dataDir}/globalPerms.json when it is missing
 * (or on explicit reset). Resolve never reads this — it only reads the three
 * on-disk files: session → workspace → global.
 */
import type { ToolDef } from "../types";
import type { PermissionMode, PermsFile } from "../../../../../_shared/types";

/**
 * Build default permission map from registered ToolDef[].
 * Single source of truth: each tool's permissionDefault field.
 */
export function getDefaultsFromTools(tools: ToolDef[]): Record<string, PermissionMode> {
  const out: Record<string, PermissionMode> = {};
  for (const t of tools) {
    out[t.name] = t.permissionDefault;
  }
  return out;
}

/**
 * Module-level registry reference. Set once at startup by createDefaultRegistry().
 * buildDefaultGlobalFile() reads permissionDefault from these tools.
 */
let registeredTools: ToolDef[] | undefined;

/**
 * Register tools for default generation. Called once at startup.
 * Must be called before any call to buildDefaultGlobalFile().
 */
export function setDefaultTools(tools: ToolDef[]): void {
  registeredTools = [...tools];
}

/**
 * Build default globalPerms.json content.
 * Uses permissionDefault from each registered ToolDef (single source of truth).
 * Throws if no tools registered — this is a programming error, not a runtime condition.
 */
export function buildDefaultGlobalFile(): PermsFile {
  if (!registeredTools) {
    throw new Error(
      "buildDefaultGlobalFile() called before setDefaultTools(). " +
      "Call setDefaultTools(tools) in createDefaultRegistry() first."
    );
  }
  return {
    version: 1,
    tools: getDefaultsFromTools(registeredTools),
  };
}
