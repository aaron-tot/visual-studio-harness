import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { liveDbPath } from "../../db/client";
import { assertArchiveSpace, checkArchiveSpace } from "./disk-space";

describe("archive disk preflight", () => {
  test("reports live bytes, requires one live-DB-size, and passes when roomy", async () => {
    const base = join(tmpdir(), `vsh-space-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const dataDir = join(base, "data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(liveDbPath(dataDir), Buffer.alloc(1024));

    const r = checkArchiveSpace(dataDir);
    expect(r.liveBytes).toBe(1024);
    expect(r.requiredBytes).toBe(1024);
    expect(r.ok).toBe(r.availableBytes >= r.requiredBytes);
    expect(() => assertArchiveSpace(dataDir, "test")).not.toThrow();

    await rm(base, { recursive: true, force: true });
  });
});
