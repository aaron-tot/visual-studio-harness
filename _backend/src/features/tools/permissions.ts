/** Env flags only. Layered resolve lives in perms/resolve.ts */

export function toolsEnabled(): boolean {
  const v = process.env.VISUAL_STUDIO_HARNESS_TOOLS_ENABLED;
  if (v === "0" || v === "false") return false;
  return true;
}

export function toolsTrusted(): boolean {
  const v = process.env.VISUAL_STUDIO_HARNESS_TOOLS_TRUSTED;
  return v === "1" || v === "true";
}
