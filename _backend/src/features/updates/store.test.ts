import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultUpdateState, loadUpdates, saveUpdates } from "./store";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vsh-updates-store-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("updates store", () => {
  test("default state has no successful check", () => {
    const s = defaultUpdateState();
    expect(s.lastChecked).toBeNull();
    expect(s.available).toBe(false);
    expect(s.commitsBehind).toBe(0);
  });

  test("save/load round-trips runtime fields", async () => {
    await saveUpdates(dataDir, {
      lastChecked: "2026-07-14T00:00:00.000Z",
      available: true,
      buildCommit: "ignored-on-load",
      latestCommit: "abc",
      commitsBehind: 2,
      lastError: null,
    });
    const loaded = await loadUpdates(dataDir);
    expect(loaded.available).toBe(true);
    expect(loaded.commitsBehind).toBe(2);
    expect(loaded.latestCommit).toBe("abc");
    expect(loaded.lastChecked).toBe("2026-07-14T00:00:00.000Z");
  });

  test("load of a missing file returns the default (no throw)", async () => {
    const s = await loadUpdates(dataDir);
    expect(s.lastChecked).toBeNull();
    expect(s.available).toBe(false);
  });

  test("load of corrupt json returns the default (no throw)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dataDir, "updates.json"), "{not json", "utf-8");
    const s = await loadUpdates(dataDir);
    expect(s.available).toBe(false);
  });
});
