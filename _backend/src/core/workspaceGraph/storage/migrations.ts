import { openWorkspaceGraphDb, WorkspaceGraphDb } from "./db";

export interface MigrationResult {
  applied: number;
  errors: string[];
}

export function runMigrations(dbPath: string): MigrationResult {
  const db = openWorkspaceGraphDb(dbPath);
  const sqlite = (db as any).session?.client as { run: (sql: string) => void } | undefined;

  if (!sqlite) return { applied: 0, errors: [] };

  const result: MigrationResult = { applied: 0, errors: [] };

  const migrations: { version: number; sql: string; description: string }[] = [
    {
      version: 1,
      description: "Initial workspace graph schema",
      sql: "",
    },
  ];

  const currentVersion = getCurrentGraphVersion(db);

  for (const m of migrations) {
    if (m.version <= currentVersion) continue;
    try {
      if (m.sql) sqlite.run(m.sql);
      setCurrentGraphVersion(db, m.version);
      result.applied++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Migration v${m.version} (${m.description}): ${msg}`);
    }
  }

  return result;
}

export function getCurrentGraphVersion(db: WorkspaceGraphDb): number {
  const raw = db.get<{ graph_version: number }>(
    // @ts-expect-error raw SQL
    "SELECT graph_version FROM workspaces ORDER BY rowid DESC LIMIT 1"
  );
  return raw?.graph_version ?? 0;
}

function setCurrentGraphVersion(db: WorkspaceGraphDb, version: number): void {
  // @ts-expect-error raw SQL
  db.run("UPDATE workspaces SET graph_version = ?", [version]);
}