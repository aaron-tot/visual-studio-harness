import { existsSync, statSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { archiveDbPath, liveDbPath } from "../../db/client";

/** Thrown when an archive/migration is refused because the disk is too full. */
export class InsufficientDiskSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientDiskSpaceError";
  }
}

function fileBytes(path: string): number {
  try {
    return existsSync(path) ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}

function fmt(n: number): string {
  return `${(n / 1e6).toFixed(1)} MB`;
}

export interface ArchiveSpaceReport {
  ok: boolean;
  /** Free bytes required to run the migration safely. */
  requiredBytes: number;
  /** Free bytes currently available on the data filesystem. */
  availableBytes: number;
  liveBytes: number;
  archiveBytes: number;
}

/**
 * Preflight for archiving: moving a session copies it into the archive DB, then
 * deletes it from the live DB and VACUUMs the live DB.
 *
 * The dominant cost is the VACUUM temp rebuild of the live DB (~= live DB size).
 * The archive growth is a subset of the live DB and folds within that budget:
 * the copy consumes <free> first, then the post-delete VACUUM temp only needs the
 * remainder (file size − copied subset). So requiring one live-DB-size of free
 * space is sufficient and never underestimates.
 *
 * Logs a `[archive] disk preflight` line every call (findings + verdict).
 */
export function checkArchiveSpace(dataDir?: string): ArchiveSpaceReport {
  const live = liveDbPath(dataDir);
  const arch = archiveDbPath(dataDir);
  const liveBytes = fileBytes(live);
  const archiveBytes = fileBytes(arch);
  const requiredBytes = liveBytes;
  const fs = statfsSync(dirname(live));
  const availableBytes = Number(fs.bavail) * Number(fs.bsize);
  const ok = availableBytes >= requiredBytes;
  console.log(
    `[archive] disk preflight: liveDB=${fmt(liveBytes)} archiveDB=${fmt(archiveBytes)} ` +
      `free=${fmt(availableBytes)} required=${fmt(requiredBytes)} -> ${ok ? "OK" : "INSUFFICIENT"}`
  );
  return { ok, requiredBytes, availableBytes, liveBytes, archiveBytes };
}

/** Fail loudly (before any copy) when there is not enough room to archive. */
export function assertArchiveSpace(dataDir?: string, context = "archive"): void {
  const r = checkArchiveSpace(dataDir);
  if (!r.ok) {
    throw new InsufficientDiskSpaceError(
      `[archive] insufficient disk space (${context}): need ${fmt(r.requiredBytes)} free, have ${fmt(r.availableBytes)}`
    );
  }
}
