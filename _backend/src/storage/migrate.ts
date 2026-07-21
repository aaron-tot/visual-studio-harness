/**
 * @deprecated Old file-based session migration.
 * Trace schema is the only storage format. No migration needed for greenfield.
 */
export async function migrateToSqlite(): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  try {
    const { getDb } = await import("../db/client");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    db.run(sql`DROP TABLE IF EXISTS messages`);
    db.run(sql`DROP TABLE IF EXISTS parts`);
  } catch {
    // Tables may not exist; ignore
  }
  return { migrated: 0, skipped: 0, errors: [] };
}
