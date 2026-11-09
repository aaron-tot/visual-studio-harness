import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDbForDataDir } from "../../db/client";
import { createSession } from "../sessions/db";
import { createTurn, createStep, finalizeStep, finalizeTurnTrace } from "./db-trace";
import { projectSessionChat } from "./project-chat";
import { projectSessionChatPage } from "./history-page";
import { CHAT_HISTORY_PAGE, isCountedBubble } from "../../../../_shared/chat-history";

let dataDir: string;
const now = new Date().toISOString();

beforeAll(async () => {
  const base = join(tmpdir(), `vsh-hpage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  getDbForDataDir(dataDir);
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

function seedSession(sessionId: string) {
  createSession(
    { id: sessionId, title: sessionId, providerName: "t", modelName: "m", created: now, updated: now },
    dataDir
  );
}

function addTurn(sessionId: string, turnNumber: number, success = true) {
  const t = createTurn(sessionId, turnNumber, `prompt ${turnNumber}`, now, { modelName: "m" }, dataDir);
  const s = createStep(t, sessionId, 0, { modelId: "m", providerName: "p" }, dataDir);
  finalizeStep(s, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, dataDir);
  finalizeTurnTrace(
    t,
    success ? { success: true } : { success: false, errorMessage: "boom" },
    dataDir
  );
  return t;
}

describe("projectSessionChatPage", () => {
  test("returns only the newest PAGE bubbles and reports hasMore/cursor", () => {
    const sid = "page-basic";
    seedSession(sid);
    addTurn(sid, 1);
    addTurn(sid, 2);
    addTurn(sid, 3);

    const page = projectSessionChatPage(sid, { dataDir });
    // PAGE = 2 => exactly the newest successful turn (user + assistant).
    expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(page.messages.filter(isCountedBubble).length).toBe(CHAT_HISTORY_PAGE);
    expect(page.cursor).toBe(3);
    expect(page.hasMore).toBe(true);
  });

  test("paging with beforeTurnNumber reconstitutes the full history", () => {
    const sid = "page-recon";
    seedSession(sid);
    addTurn(sid, 1);
    addTurn(sid, 2);
    addTurn(sid, 3);
    addTurn(sid, 4);

    const full = projectSessionChat(sid, dataDir);

    const collected: number[] = [];
    let cursor: number | null = null;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard++ < 100) {
      const page = projectSessionChatPage(sid, { beforeTurnNumber: cursor, dataDir });
      collected.unshift(...page.messages.map((m) => m.id as number));
      hasMore = page.hasMore;
      cursor = page.cursor;
    }

    expect(collected).toEqual(full.map((m) => m.id as number));
  });

  test("respects a custom limit (configurable page size)", () => {
    const sid = "page-limit";
    seedSession(sid);
    addTurn(sid, 1);
    addTurn(sid, 2);
    addTurn(sid, 3);

    // limit=4 => two successful turns (4 bubbles), ascending.
    const page = projectSessionChatPage(sid, { dataDir, limit: 4 });
    expect(page.messages.filter(isCountedBubble).length).toBe(4);
    expect(page.messages.map((m) => m.turnId)).toEqual([2, 2, 3, 3]);
    expect(page.cursor).toBe(2); // oldest included turn (turns 3 and 2)
    expect(page.hasMore).toBe(true); // turn 1 remains older
  });

  test("error bubbles are delivered but do not consume the bubble budget", () => {
    const sid = "page-error";
    seedSession(sid);
    addTurn(sid, 1); // success
    addTurn(sid, 2, false); // newest turn fails -> assistant is an error bubble

    const page = projectSessionChatPage(sid, { dataDir });
    // The failed turn contributes 1 counted bubble (its user message), so the
    // page must reach back into turn 1 to satisfy the PAGE budget.
    expect(page).not.toBeNull();
    expect(page.messages.some((m) => m.role === "assistant" && m.success === false)).toBe(true);
    expect(page.messages.filter(isCountedBubble).length).toBeGreaterThanOrEqual(CHAT_HISTORY_PAGE);
    // Newest rendered bubble is the failed assistant turn.
    expect(page.messages[page.messages.length - 1].role).toBe("assistant");
  });
});
