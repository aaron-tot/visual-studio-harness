/**
 * Probe local LLM servers (llama.cpp server style) for parallel slots.
 * OpenAI-compatible cloud providers typically lack /slots -> treated as unsupported (skip gate).
 */

export interface SlotProbeResult {
  /** False when server has no slots API (skip capacity checks). */
  supported: boolean;
  total: number;
  free: number;
  busy: number;
  modelAlias?: string;
  modelPath?: string;
  /** Human-readable detail for errors / UI */
  detail: string;
  error?: string;
}

/** Strip /v1 (or trailing path) so /slots and /props resolve on server root. */
export function serverOriginFromBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    // common OpenAI-compat suffix
    if (u.pathname === "/v1" || u.pathname.endsWith("/v1")) {
      u.pathname = u.pathname.replace(/\/v1\/?$/, "") || "/";
    }
    // drop trailing slash on path except root
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.origin + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return trimmed.replace(/\/v1\/?$/, "");
  }
}

interface SlotRow {
  id?: number;
  is_processing?: boolean;
}

async function fetchJson(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 4000
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Probe llama.cpp-style /slots (+ optional /props).
 * Returns supported:false if endpoints missing (non-local or disabled).
 */
export async function probeServerSlots(
  baseUrl: string,
  signal?: AbortSignal
): Promise<SlotProbeResult> {
  const origin = serverOriginFromBaseUrl(baseUrl);
  if (!origin) {
    return {
      supported: false,
      total: 0,
      free: 0,
      busy: 0,
      detail: "empty base URL",
      error: "empty base URL",
    };
  }

  try {
    const slotsRes = await fetchJson(`${origin}/slots`, signal);
    if (slotsRes.status === 404 || slotsRes.status === 501) {
      return {
        supported: false,
        total: 0,
        free: 0,
        busy: 0,
        detail: `no /slots endpoint (${slotsRes.status})`,
      };
    }
    if (!slotsRes.ok || !Array.isArray(slotsRes.data)) {
      // Some builds need auth or return error object
      if (
        slotsRes.data &&
        typeof slotsRes.data === "object" &&
        "error" in (slotsRes.data as object)
      ) {
        return {
          supported: false,
          total: 0,
          free: 0,
          busy: 0,
          detail: `slots unavailable: ${JSON.stringify((slotsRes.data as { error?: unknown }).error)}`,
        };
      }
      return {
        supported: false,
        total: 0,
        free: 0,
        busy: 0,
        detail: `slots HTTP ${slotsRes.status}`,
        error: `slots HTTP ${slotsRes.status}`,
      };
    }

    const rows = slotsRes.data as SlotRow[];
    const total = rows.length;
    const busy = rows.filter((s) => s.is_processing === true).length;
    const free = total - busy;

    let modelAlias: string | undefined;
    let modelPath: string | undefined;
    let propsTotal: number | undefined;
    try {
      const propsRes = await fetchJson(`${origin}/props`, signal);
      if (propsRes.ok && propsRes.data && typeof propsRes.data === "object") {
        const p = propsRes.data as {
          total_slots?: number;
          model_alias?: string;
          model_path?: string;
        };
        if (typeof p.total_slots === "number") propsTotal = p.total_slots;
        modelAlias = p.model_alias;
        modelPath = p.model_path;
      }
    } catch {
      // props optional
    }

    const effectiveTotal = propsTotal ?? total;
    return {
      supported: true,
      total: effectiveTotal,
      free,
      busy,
      modelAlias,
      modelPath,
      detail: `${free}/${effectiveTotal} slots free` + (modelAlias ? ` (${modelAlias})` : ""),
    };
  } catch (err: unknown) {
    if (signal?.aborted) {
      return {
        supported: false,
        total: 0,
        free: 0,
        busy: 0,
        detail: "aborted",
        error: "aborted",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Unreachable server: treat as supported probe failure so wait/fail can surface it
    const refused =
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("Unable to connect");
    return {
      supported: true,
      total: 0,
      free: 0,
      busy: 0,
      detail: refused
        ? `server unreachable at ${origin}`
        : `slot probe failed: ${msg}`,
      error: msg,
    };
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
