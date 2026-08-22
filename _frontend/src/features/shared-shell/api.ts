import type { Shell, ShellSnapshot } from "./types";

const BASE = "/api/shared-shell";

export async function createShellApi(sessionId: string, name?: string, cwd?: string): Promise<{ ok: boolean; shell?: Shell; error?: string }> {
  const res = await fetch(`${BASE}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, name, cwd }),
  });
  return res.json();
}

export async function listShellsApi(sessionId: string): Promise<{ shells: Shell[] }> {
  const res = await fetch(`${BASE}/${sessionId}`);
  return res.json();
}

export async function writeShellApi(id: string, data: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${BASE}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, data }),
  });
  return res.json();
}

export async function resizeShellApi(id: string, cols: number, rows: number): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${BASE}/resize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, cols, rows }),
  });
  return res.json();
}

export async function getShellOutputApi(id: string): Promise<{ output: string }> {
  const res = await fetch(`${BASE}/output`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

/** Persist a shell's rendered xterm snapshot for exact restore on refresh. */
export async function putShellSnapshotApi(
  id: string,
  cols: number,
  rows: number,
  serialized: string
): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${BASE}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, cols, rows, serialized }),
  });
  return res.json();
}

/** Fetch a shell's saved snapshot (null if none written yet). */
export async function getShellSnapshotApi(id: string): Promise<{ snapshot: ShellSnapshot | null }> {
  const res = await fetch(`${BASE}/snapshot/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function closeShellApi(id: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch(`${BASE}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function closeSessionShellsApi(sessionId: string): Promise<{ ok?: boolean }> {
  const res = await fetch(`${BASE}/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  return res.json();
}
