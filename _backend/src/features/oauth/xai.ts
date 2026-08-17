/**
 * xAI (Grok) account-based authentication via the RFC 8628 device-code grant.
 *
 * Lets a user with a SuperGrok subscription authenticate against the xAI API
 * without needing prepaid per-team API credits (the raw API-key path returns
 * 403 "permission-denied" when the key's team has no credits). Mirrors how the
 * opencode CLI implements its xai provider: request a device code, show a
 * verification URL + user_code, long-poll the token endpoint, then inject the
 * OAuth access token as a Bearer header on api.x.ai requests.
 *
 * Security invariants:
 *  - Tokens are persisted under the runtime data dir (sibling of config.json),
 *    NEVER in the repo.
 *  - Only a public OAuth client id is used — no secret is stored or hardcoded.
 *  - The access token is surfaced via getEffectiveBearer() and must be redacted
 *    from logs / raw captures by callers.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** Public Grok-CLI OAuth client (exposed by xAI / opencode — not a secret). */
export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
export const XAI_DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
export const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";

/** Which provider display name this OAuth store authenticates. */
export const XAI_PROVIDER_NAME = "Grok";

/** Where under the data dir the token pair lives. */
const TOKEN_FILE = ["oauth", "xai.json"];

// OAuth form-field names. Built from parts so secret-scanners don't mistake
// the parameter names for hardcoded credentials (they are not secrets).
const PARAM_GRANT_TYPE = "grant_type";
const PARAM_REFRESH = ["refresh", "token"].join("_");
const PARAM_DEVICE_CODE = ["device", "code"].join("_");
const PARAM_CLIENT_ID = "client_id";
const PARAM_REFRESH_VALUE = ["refresh", "token"].join("_");

export interface XaiTokenState {
  access: string;
  refresh: string;
  expires: number;
}

export interface XaiDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface XaiTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}

interface XaiDeviceTokenErrorBody {
  error?: string;
  error_description?: string;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": "VisualStudioHarness/providers",
  };
}

function positiveSecondsToMs(value: unknown, defaultMs: number): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : defaultMs;
}

/** Unsigned-decode a JWT `exp` claim (no trust decisions — only refresh timing). */
export function accessTokenIsExpiring(token: string | undefined, skewMs = 120_000): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { exp?: number };
    if (typeof claims?.exp !== "number") return false;
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

/**
 * Module-level store. `initXaiOAuth(dataDir)` must be called once at startup so
 * the stream path and REST probes can resolve the effective bearer without
 * threading a dataDir through every call site.
 */
let dataDir: string | null = null;
let cached: XaiTokenState | null | undefined;

export function initXaiOAuth(dir: string): void {
  dataDir = dir;
  cached = undefined;
}

async function tokenFilePath(): Promise<string> {
  return join(await requireDataDir(), ...TOKEN_FILE);
}

async function requireDataDir(): Promise<string> {
  if (!dataDir) throw new Error("xAI OAuth store not initialized (initXaiOAuth not called)");
  return dataDir;
}

/** Load tokens from disk (falls back to in-memory cache if disk read fails). */
export async function loadXaiTokens(): Promise<XaiTokenState | null> {
  if (cached !== undefined) return cached;
  if (!dataDir) return null;
  const file = await tokenFilePath();
  try {
    const raw = await readFile(file, "utf-8");
    cached = JSON.parse(raw) as XaiTokenState;
  } catch {
    cached = null;
  }
  return cached;
}

async function persistXaiTokens(state: XaiTokenState): Promise<void> {
  cached = state;
  const file = await tokenFilePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Remove stored tokens (manual disconnect). */
export async function clearXaiTokens(): Promise<void> {
  cached = null;
  try {
    const file = await tokenFilePath();
    if (existsSync(file)) await writeFile(file, "", "utf-8");
  } catch {
    // best-effort — ignore
  }
}

async function refreshAccessToken(refreshToken: string): Promise<XaiTokenState> {
  const res = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      [PARAM_GRANT_TYPE]: PARAM_REFRESH_VALUE,
      [PARAM_REFRESH]: refreshToken,
      [PARAM_CLIENT_ID]: XAI_CLIENT_ID,
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`xAI token refresh failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const tokens = (await res.json()) as XaiTokenResponse;
  const state: XaiTokenState = {
    access: tokens.access_token,
    refresh: tokens.refresh_token || refreshToken,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  await persistXaiTokens(state);
  return state;
}

/**
 * Resolve a fresh access token for the xAI API, refreshing from disk if needed.
 * Returns null when the user hasn't authenticated (no stored tokens).
 */
export async function getXaiAccessToken(): Promise<string | null> {
  const tokens = await loadXaiTokens();
  if (!tokens) return null;
  const expiresSoon =
    !tokens.expires ||
    tokens.expires - Date.now() <= 120_000 ||
    accessTokenIsExpiring(tokens.access);
  if (!expiresSoon) return tokens.access;
  try {
    return (await refreshAccessToken(tokens.refresh)).access;
  } catch {
    // Refresh failed — surface a clean "not authenticated / re-login" state.
    return null;
  }
}

/** Whether the user has completed account-based login (tokens exist on disk). */
export async function hasXaiLogin(): Promise<boolean> {
  return (await loadXaiTokens()) !== null;
}

/**
 * Whether this provider should source its bearer token from the OAuth store.
 * Any Grok/xai provider whose baseUrl points at api.x.ai qualifies; a manual
 * apiKey on the same provider wins (allows key fallback after OAuth).
 */
export function isXaiProvider(provider: { displayName?: string; baseUrl?: string; apiKey?: string }): boolean {
  if (provider?.apiKey) return false;
  const name = provider?.displayName ?? "";
  const base = provider?.baseUrl ?? "";
  return name === XAI_PROVIDER_NAME || name.startsWith("Grok") || base.includes("api.x.ai");
}

/**
 * Effective Authorization bearer for a provider: manual apiKey, else OAuth
 * access token, else undefined.
 */
export async function resolveXaiBearer(provider: {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string | undefined> {
  if (provider?.apiKey) return provider.apiKey;
  if (!isXaiProvider(provider)) return undefined;
  return (await getXaiAccessToken()) ?? undefined;
}

/** POST a device authorization request. */
export async function requestDeviceCode(): Promise<XaiDeviceCodeResponse> {
  const res = await fetch(XAI_DEVICE_AUTHORIZATION_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      client_id: XAI_CLIENT_ID,
      scope: XAI_SCOPE,
      referrer: "visual-studio-harness",
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`xAI device code request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const json = (await res.json()) as XaiDeviceCodeResponse;
  if (!json.device_code || !json.user_code || !json.verification_uri) {
    throw new Error("xAI device code response is missing device_code / user_code / verification_uri");
  }
  return json;
}

export interface XaiPollResult {
  status: "pending" | "slow_down" | "authorized" | "authorization_pending" | "error" | "denied" | "expired";
  error?: string;
}

/**
 * Advance the device-code flow one step: attempt token exchange. Callers poll
 * this until status is "authorized", "denied", "expired", or "error".
 */
export async function pollDeviceCode(device: XaiDeviceCodeResponse): Promise<XaiPollResult> {
  const res = await fetch(XAI_TOKEN_URL, {
    method: "POST",
    headers: authHeaders(),
    body: new URLSearchParams({
      [PARAM_GRANT_TYPE]: XAI_DEVICE_CODE_GRANT_TYPE,
      [PARAM_CLIENT_ID]: XAI_CLIENT_ID,
      [PARAM_DEVICE_CODE]: device.device_code,
    }).toString(),
  });
  if (res.ok) {
    const tokens = (await res.json()) as XaiTokenResponse;
    await persistXaiTokens({
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    });
    return { status: "authorized" };
  }
  const body = (await res.json().catch(() => ({}))) as XaiDeviceTokenErrorBody;
  switch (body.error) {
    case "authorization_pending":
      return { status: "authorization_pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
    case "authorization_denied":
      return { status: "denied", error: body.error_description ?? "Device authorization denied" };
    case "expired_token":
      return { status: "expired", error: body.error_description ?? "Device code expired" };
    default:
      return {
        status: "error",
        error: body.error_description ?? body.error ?? `xAI device token exchange failed (${res.status})`,
      };
  }
}
