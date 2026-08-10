import { readFileSync } from "node:fs";

export const APP_SLUG = "visual-studio-harness";
export const APP_TITLE = "Visual Studio Harness";
export const APP_HOMEPAGE = "https://github.com/aaron-tot/visual-studio-harness";

let cachedVersion: string | undefined;

function loadVersion(): string {
  try {
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "dev";
  } catch {
    return "dev";
  }
}

export function getAppVersion(): string {
  if (cachedVersion === undefined) cachedVersion = loadVersion();
  return cachedVersion;
}

export function identityHeaders(input: {
  sessionId?: string;
  parentSessionId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": `${APP_SLUG}/${getAppVersion()}`,
    "X-Title": APP_TITLE,
    "HTTP-Referer": APP_HOMEPAGE,
  };
  if (input.sessionId) {
    headers["X-Session-Id"] = input.sessionId;
    headers["x-session-affinity"] = input.sessionId;
  }
  if (input.parentSessionId) {
    headers["x-parent-session-id"] = input.parentSessionId;
  }
  return headers;
}
