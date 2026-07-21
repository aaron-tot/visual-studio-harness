import type { BaseToolContext } from "./types";
import { classifyPath, SandboxError } from "./sandbox";
import { resolveToolPermission } from "./perms/resolve";

/** Permission key prefix for reading/writing outside the session workspace, per tool. */
export const EXTERNAL_DIRECTORY_PREFIX = "external_directory:";

/**
 * Resolve a path for a tool. Inside workspace: always ok (tool perm already checked).
 * Outside workspace: requires layered permission `external_directory:<toolName>`
 * (session > workspace > global), where <toolName> is the executing tool.
 */
export async function resolveAccessiblePath(
  ctx: BaseToolContext,
  userPath: string
): Promise<string> {
  const c = classifyPath(ctx.workspaceRoot, userPath);

  if (!c.outsideWorkspace) {
    return c.abs;
  }

  const toolName = ctx.toolName ?? "tool";
  const externalKey = EXTERNAL_DIRECTORY_PREFIX + toolName;

  const mode = await resolveToolPermission(externalKey, {
    dataDir: ctx.dataDir,
    sessionId: ctx.sessionId,
    workspaceRoot: ctx.workspaceRoot,
  });

  if (mode === "deny") {
    throw new SandboxError(
      `ERROR permission: external_directory:${toolName} is denied — cannot access path outside workspace (${userPath} -> ${c.abs})`
    );
  }

  if (mode === "ask") {
    const ok = await ctx.askPermission(externalKey, {
      path: userPath,
      absolutePath: c.abs,
      workspaceRoot: c.workspaceRoot,
      reason: "Path is outside the session workspace",
      toolName,
    });
    if (!ok) {
      throw new SandboxError(
        `ERROR permission: external_directory:${toolName} denied by user for path '${userPath}'`
      );
    }
  }

  return c.abs;
}
