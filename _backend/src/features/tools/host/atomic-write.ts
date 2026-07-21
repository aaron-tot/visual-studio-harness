import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Write content atomically (temp file in same dir + rename). */
export async function atomicWriteFile(absPath: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
  const tmp = join(dirname(absPath), `.tmp.${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, absPath);
  } catch (err) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}
