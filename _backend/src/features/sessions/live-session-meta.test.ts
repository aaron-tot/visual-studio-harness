import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDbForDataDir } from "../../db/client";
import { createSession } from "./db";
import { getLiveSessionMeta, getSession } from "./store";
import {
  createTurn,
  createStep,
  finalizeStep,
  finalizeTurnTrace,
} from "../chat/db-trace";

let dataDir: string;

beforeAll(async () => {
  const base = join(
    tmpdir(),
    `vsh-meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  dataDir = join(base, "data");
  await mkdir(join(dataDir, "sessions"), { recursive: true });
  getDbForDataDir(dataDir);
});

afterAll(async () => {
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

describe("getLiveSessionMeta", () => {
  test("returns meta only — no messages, no chat projection", async () => {
    const now = new Date().toISOString();
    // A session that HAS a turn — the old store.getSession would hydrate here.
    createSession(
      { id: "meta-1", title: "Meta One", providerName: "t", modelName: "m", created: now, updated: now },
      dataDir,
    );
    const t = createTurn("meta-1", 1, "hello", now, {}, dataDir);
    const s = createStep(t, "meta-1", 0, {}, dataDir);
    finalizeStep(s, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, dataDir);
    finalizeTurnTrace(t, { success: true }, dataDir);

    const meta = await getLiveSessionMeta(dataDir, "meta-1");
    expect(meta).not.toBeNull();
    expect(meta!.id).toBe("meta-1");
    expect(meta!.title).toBe("Meta One");
    expect(meta).not.toHaveProperty("messages");

    // Control: the hydrate path DOES build the chat for the same session —
    // proves the meta reader genuinely skips projectSessionChat.
    const hydrated = await getSession(dataDir, "meta-1");
    expect(hydrated).not.toBeNull();
    expect(Array.isArray(hydrated!.messages)).toBe(true);
  });

  test("returns null for a missing session", async () => {
    expect(await getLiveSessionMeta(dataDir, "no-such-id")).toBeNull();
  });
});
