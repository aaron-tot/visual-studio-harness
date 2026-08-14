import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdates } from "./check";
import { defaultUpdateState, saveUpdates } from "./store";
import type { ConfigFile } from "../../../../_shared/types";

const CONFIG: ConfigFile = { providers: [] };

function stubFetch(
  respond: (url: string) => { ok: boolean; status: number; json: () => unknown }
): string[] {
  const calls: string[] = [];
  // @ts-expect-error intentional test stub
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    calls.push(url);
    const r = respond(url);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json(),
    } as Response;
  };
  return calls;
}

let dataDir: string;
const buildCommit = "0123456789abcdef0123456789abcdef01234567"; // pragma: allowlist secret

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vsh-updates-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  (globalThis as Record<string, unknown>).fetch = undefined;
});

describe("checkForUpdates", () => {
  test("is a no-op in dev (no network, no persistence)", async () => {
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return { ok: false, status: 0, json: () => ({}) as never };
    });
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "dev", buildCommit });
    expect(fetched).toBe(false);
    expect(state.available).toBe(false);
    expect(state.lastError).toBeNull();
  });

  test("records update available when ahead of main", async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ ahead_by: 3, commits: [{ sha: "a1" }, { sha: "b2" }, { sha: "c3" }] }),
    }));
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect(state.available).toBe(true);
    expect(state.commitsBehind).toBe(3);
    expect(state.latestCommit).toBe("c3");
    expect(state.lastChecked).not.toBeNull();
    expect(state.lastError).toBeNull();
  });

  test("marks up to date when behind count is zero", async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ ahead_by: 0, commits: [] }),
    }));
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect(state.available).toBe(false);
    expect(state.commitsBehind).toBe(0);
    expect(state.latestCommit).toBe(buildCommit);
  });

  test("same-day successful check is skipped until force", async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ ahead_by: 0, commits: [] }),
    }));
    await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect((globalThis as { fetch: unknown }).fetch).toBeDefined();

    // Second, unforced check today must NOT hit the network.
    let hit = false;
    stubFetch(() => {
      hit = true;
      return { ok: true, status: 200, json: () => ({ ahead_by: 0, commits: [] }) };
    });
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect(hit).toBe(false);
    expect(state.lastChecked).not.toBeNull();
  });

  test("force bypasses the same-day skip", async () => {
    await saveUpdates(dataDir, {
      ...defaultUpdateState(),
      lastChecked: new Date().toISOString(),
    });
    const calls = stubFetch(() => ({
      ok: true,
      status: 200,
      json: () => ({ ahead_by: 1, commits: [{ sha: "zz" }] }),
    }));
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", force: true, buildCommit });
    expect(calls.length).toBe(1);
    expect(state.available).toBe(true);
  });

  test("failure keeps lastChecked unchanged and records lastError", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect(state.lastChecked).toBeNull();
    expect(state.lastError).toContain("network down");
  });

  test("non-2xx GitHub response is a failure that does not advance lastChecked", async () => {
    stubFetch(() => ({ ok: false, status: 404, json: () => ({ message: "Not Found" }) }));
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit });
    expect(state.lastChecked).toBeNull();
    expect(state.lastError).toContain("404");
  });

  test("empty build commit records an error without network", async () => {
    const calls = stubFetch(() => {
      throw new Error("should not fetch");
    });
    const state = await checkForUpdates({ dataDir, config: CONFIG, mode: "prod", buildCommit: "" });
    expect(calls.length).toBe(0);
    expect(state.lastChecked).toBeNull();
    expect(state.lastError).toContain("Build commit unknown");
  });
});
