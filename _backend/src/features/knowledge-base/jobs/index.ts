import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import type { KnowledgeScopeDb } from "../db";
import { knowledgeJobs } from "../schema";
import type { KbScope } from "../db";
import type { JobRecord } from "../types";

/**
 * Create a new job in the knowledge_jobs table.
 */
export async function createJob(
  db: KnowledgeScopeDb,
  type: string,
  scope: KbScope,
  payload: unknown,
  maxRetries = 3,
): Promise<string> {
  const now = new Date().toISOString();
  const id = randomUUIDv7();

  await db.db.insert(knowledgeJobs).values({
    id,
    type,
    status: "queued",
    scope,
    payload: JSON.stringify(payload),
    error: null,
    retryCount: 0,
    maxRetries,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

/**
 * List pending jobs of a given type.
 */
export async function listPendingJobs(
  db: KnowledgeScopeDb,
  type: string,
  limit = 200,
): Promise<JobRecord[]> {
  const rows = await db.db
    .select()
    .from(knowledgeJobs)
    .where(eq(knowledgeJobs.type, type))
    .all();

  const pending = rows.filter((r) => r.status === "queued" || r.status === "processing");
  return pending.slice(0, limit).map(mapJobRecord);
}

/**
 * Update job status with optional error message.
 */
export async function updateJobStatus(
  db: KnowledgeScopeDb,
  jobId: string,
  status: string,
  error?: string,
  retryCount?: number,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (error !== undefined) updates.error = error;
  if (retryCount !== undefined) updates.retryCount = retryCount;

  await db.db
    .update(knowledgeJobs)
    .set(updates)
    .where(eq(knowledgeJobs.id, jobId));
}

/**
 * Count pending jobs by type.
 */
export async function countPendingJobs(
  db: KnowledgeScopeDb,
  type?: string,
): Promise<number> {
  const rows = await db.db
    .select()
    .from(knowledgeJobs)
    .all();

  return rows.filter((r) => {
    if (r.status !== "queued") return false;
    if (type && r.type !== type) return false;
    return true;
  }).length;
}

function mapJobRecord(row: typeof knowledgeJobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    scope: row.scope,
    payload: JSON.parse(row.payload || "{}"),
    error: row.error,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
