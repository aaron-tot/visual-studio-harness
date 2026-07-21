import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.resolve(process.cwd(), "..", "data", "dev");

export type WsCapture = {
  all: any[];
  byType: Record<string, any[]>;
};

export async function setupWsCapture(page: Page): Promise<WsCapture> {
  const all: any[] = [];
  const byType: Record<string, any[]> = {};

  await page.routeWebSocket("**/chat", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => {
      try {
        const parsed = JSON.parse(String(msg));
        all.push(parsed);
        (byType[parsed.type] ??= []).push(parsed);
      } catch {
        /* non-JSON, ignore */
      }
      server.send(msg);
    });
  });

  return { all, byType };
}

export function readSessionMeta(sessionId: string) {
  const metaPath = path.join(DATA_DIR, "sessions", sessionId, "meta.json");
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

export function assertWsContains(
  capture: WsCapture,
  type: string,
  partial: Record<string, unknown>,
) {
  const matches = capture.all.filter(
    (m) =>
      m.type === type &&
      Object.entries(partial).every(([k, v]) => m[k] === v),
  );
  if (matches.length === 0) {
    throw new Error(
      `No WS message found: type="${type}" with ${JSON.stringify(partial)}\n` +
        `Available ${type} messages: ${JSON.stringify(capture.byType[type] ?? [], null, 2)}`,
    );
  }
}

export function assertMetaField(
  sessionId: string,
  field: string,
  expected: unknown,
) {
  const meta = readSessionMeta(sessionId);
  if (meta[field] !== expected) {
    throw new Error(
      `Session ${sessionId} meta.${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(meta[field])}`,
    );
  }
}
