import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerSessionRoutes } from "../../rest/sessions";
import { getDbForDataDir } from "../../db/client";
import { getSessionAborts } from "../../features/chat/session-abort";

describe("POST /api/db/compact", () => {
  let dataDir: string;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const base = join(
      tmpdir(),
      `vsh-compact-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    dataDir = join(base, "data");
    await mkdir(join(dataDir, "sessions"), { recursive: true });
    getDbForDataDir(dataDir);

    app = Fastify({ logger: false });
    registerSessionRoutes(app, dataDir);
    await app.ready();
  });

  beforeEach(() => {
    getSessionAborts().clear();
  });

  afterAll(async () => {
    await app.close();
    await rm(join(dataDir, ".."), { recursive: true, force: true });
  });

  test("aborts all in-flight sessions then compacts the live DB", async () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    getSessionAborts().set("api-1", c1);
    getSessionAborts().set("api-2", c2);

    const res = await app.inject({
      method: "POST",
      url: "/api/db/compact",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.ok).toBe(true);
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(typeof body.freedBytes).toBe("number");
    expect(body.freedBytes).toBeGreaterThanOrEqual(0);
  });
});
