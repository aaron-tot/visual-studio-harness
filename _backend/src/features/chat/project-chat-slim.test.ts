import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDbForDataDir } from "../../db/client";
import { turns, steps } from "../../db/schema";
import { createSession } from "../sessions/db";
import {
  createTurn,
  createStep,
  finalizeStep,
  finalizeTurnTrace,
} from "./db-trace";
import {
  projectSessionChat,
  listTurnSummaries,
  getTurnDetail,
} from "./project-chat";

let dataDir: string;
const MAGIC = "RAW_MAGIC_321";

beforeAll(async () => {
  const base = join(
    tmpdir(),
    `vsh-slim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  getDbForDataDir(dataDir);
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

function seedSessionWithRaw(sessionId: string) {
  const now = new Date().toISOString();
  createSession(
    { id: sessionId, title: sessionId, providerName: "t", modelName: "m", created: now, updated: now },
    dataDir,
  );
  const t = createTurn(sessionId, 1, `prompt ${sessionId}`, now, { modelName: "m" }, dataDir);
  const s = createStep(t, sessionId, 0, { modelId: "m", providerName: "p" }, dataDir);
  finalizeStep(s, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, dataDir);
  finalizeTurnTrace(t, { success: true }, dataDir);

  const db = getDbForDataDir(dataDir);
  db.update(turns).set({ rawRequestJson: MAGIC, rawResponseJson: MAGIC }).where(eq(turns.id, t)).run();
  db.update(steps).set({ rawRequestJson: MAGIC, rawResponseJson: MAGIC }).where(eq(steps.id, s)).run();
}

describe("slim projections exclude raw dumps", () => {
  test("projectSessionChat output contains no raw blob content", () => {
    seedSessionWithRaw("slim-chat");
    const messages = projectSessionChat("slim-chat", dataDir);
    expect(messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(messages)).not.toContain(MAGIC);
  });

  test("listTurnSummaries output excludes the raw blob and any raw keys", () => {
    seedSessionWithRaw("slim-summary");
    const summaries = listTurnSummaries("slim-summary", dataDir);
    expect(summaries.length).toBe(1);
    expect(JSON.stringify(summaries)).not.toContain(MAGIC);
    expect(Object.keys(summaries[0]).join(",")).not.toMatch(/raw/i);
  });

  test("getTurnDetail turns + steps omit raw dumps", () => {
    seedSessionWithRaw("slim-detail");
    const detail = getTurnDetail("slim-detail", 1, dataDir);
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain(MAGIC);
    for (const st of detail!.steps) {
      expect(st).not.toHaveProperty("rawRequest");
      expect(st).not.toHaveProperty("rawResponse");
      expect(st).not.toHaveProperty("rawRequestJson");
      expect(st).not.toHaveProperty("rawResponseJson");
      expect(st).not.toHaveProperty("usageRawJson");
    }
  });
});
