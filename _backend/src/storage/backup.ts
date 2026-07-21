import { cp } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../paths";

export async function backupJsonSessions(): Promise<void> {
  const dataDir = resolveDataDir();
  const sessionsDir = join(dataDir, "sessions");
  const backupDir = join(dataDir, "sessions-backup");
  try {
    await cp(sessionsDir, backupDir, { recursive: true });
    console.log(`[backup] Sessions backed up to ${backupDir}`);
  } catch (err) {
    console.error("[backup] Failed:", err);
  }
}
