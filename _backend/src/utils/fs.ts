import { open, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { type FileHandle } from "node:fs/promises";

/**
 * Write a file durably and fsync it plus its parent directory.
 *
 * `writeFile` alone returns once bytes are queued to the page cache; on some
 * filesystems the data and the directory entry may not yet be visible to a
 * subsequent read (or durable across processes). Calling `fsync` on the file
 * and on the parent directory guarantees the write is flushed to disk before
 * we return, eliminating the "created but can't read it yet" race.
 */
export async function writeFileDurable(
  filePath: string,
  data: string | Uint8Array
): Promise<void> {
  const handle: FileHandle = await open(filePath, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDir(dirname(filePath));
}

/**
 * mkdir -p and fsync the resulting directory.
 */
export async function mkdirDurable(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  await syncDir(dirPath);
}

/**
 * Open the directory read-only and fsync it so its entries are durable.
 * Best-effort: ignores filesystems that reject fsync on a directory handle.
 */
export async function syncDir(dirPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  let opened = false;
  try {
    handle = await open(dirPath, "r");
    opened = true;
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  } finally {
    if (opened && handle) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
  }
}
