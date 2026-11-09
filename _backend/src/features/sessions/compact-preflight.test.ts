import { describe, expect, test, mock } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { liveDbPath } from "../../db/client";

// Force the preflight to fail regardless of the real filesystem, so we can prove
// the VACUUM is never attempted when there is no room.
class FakeInsufficient extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientDiskSpaceError";
  }
}

mock.module("./disk-space", () => ({
  InsufficientDiskSpaceError: FakeInsufficient,
  checkArchiveSpace: () => ({ ok: false, requiredBytes: 1e15, availableBytes: 0, liveBytes: 1e15, archiveBytes: 0 }),
  assertArchiveSpace: () => {
    throw new FakeInsufficient("[archive] insufficient disk space (test)");
  },
}));

const { compactLiveDb } = await import("./archive");

describe("compaction disk preflight", () => {
  test("compactLiveDb refuses before VACUUM when space is insufficient", async () => {
    const base = join(tmpdir(), `vsh-cpre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const dataDir = join(base, "data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(liveDbPath(dataDir), Buffer.alloc(2048));

    let caught: unknown;
    try {
      compactLiveDb(dataDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FakeInsufficient);

    await rm(base, { recursive: true, force: true });
  });
});
