import { eq, and } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import type { KnowledgeScopeDb, KbScope } from "./db";
import { knowledgeJobs } from "./schema";

export interface JobRecord {
  id: string;
  type: string;
  status: string;
  scope: string;
  payload: Record<string, unknown>;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create a job in the queue.
 */
export async function createJob(
  kb: KnowledgeScopeDb,
  type: string,
  scope: KbScope,
  payload: Record<string, unknown> = {},
): Promise<JobRecord> {
  const now = new Date().toISOString();
  const id = randomUUIDv7();

  await kb.db.insert(knowledgeJobs).values({
    id,
    type,
    status: "queued",
    scope,
    payload: JSON.stringify(payload),
    error: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id, type, status: "queued", scope,
    payload, error: null, retryCount: 0, maxRetries: 3,
    createdAt: now, updatedAt: now,
  };
}

/**
 * List pending jobs of a given type.
 */
export async function listPendingJobs(
  kb: KnowledgeScopeDb,
  type?: string,
): Promise<JobRecord[]> {
  const conditions = [eq(knowledgeJobs.status, "queued")];
  if (type) {
    conditions.push(eq(knowledgeJobs.type, type));
  }

  const rows = await kb.db
    .select()
    .from(knowledgeJobs)
    .where(and(...conditions))
    .orderBy(knowledgeJobs.createdAt)
    .limit(100);

  return rows.map(rowToJob);
}

/**
 * Update job status.
 */
export async function updateJobStatus(
  kb: KnowledgeScopeDb,
  id: string,
  status: string,
  error?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status, updatedAt: now };
  if (error !== undefined) {
    (update as any).error = error;
  }
  if (status === "failed") {
    // Increment retry count
    const job = await kb.db
      .select()
      .from(knowledgeJobs)
      .where(eq(knowledgeJobs.id, id))
      .get();
    if (job) {
      (update as any).retryCount = job.retryCount + 1;
    }
  }

  await kb.db
    .update(knowledgeJobs)
    .set(update as any)
    .where(eq(knowledgeJobs.id, id));
}

function rowToJob(row: typeof knowledgeJobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    scope: row.scope,
    payload: safeJsonParse(row.payload, {}),
    error: row.error,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Claim the next pending job of a given type, atomically.
 * Sets status to 'processing' and returns the job record.
 */
export async function claimNextJob(
  kb: KnowledgeScopeDb,
  type: string,
): Promise<JobRecord | null> {
  const now = new Date().toISOString();
  // Use a transaction to atomically claim the job
  const job = kb.sqlite
    .query(
      `SELECT id, type, status, scope, payload, error, retry_count, max_retries, created_at, updated_at
       FROM knowledge_jobs
       WHERE type = ? AND status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get(type) as {
      id: string; type: string; status: string; scope: string;
      payload: string; error: string | null; retry_count: number;
      max_retries: number; created_at: string; updated_at: string;
    } | undefined;

  if (!job) return null;

  kb.sqlite.run(
    "UPDATE knowledge_jobs SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'",
    [now, job.id],
  );

  return {
    id: job.id,
    type: job.type,
    status: 'processing',
    scope: job.scope,
    payload: safeJsonParse(job.payload, {}),
    error: job.error,
    retryCount: job.retry_count,
    maxRetries: job.max_retries,
    createdAt: job.created_at,
    updatedAt: now,
  };
}

/**
 * Mark a job as completed.
 */
export async function completeJob(
  kb: KnowledgeScopeDb,
  id: string,
): Promise<void> {
  const now = new Date().toISOString();
  kb.sqlite.run(
    "UPDATE knowledge_jobs SET status = 'completed', updated_at = ? WHERE id = ?",
    [now, id],
  );
}

/**
 * Mark a job as failed with an error message.
 */
export async function failJob(
  kb: KnowledgeScopeDb,
  id: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  const job = kb.sqlite
    .query("SELECT retry_count FROM knowledge_jobs WHERE id = ?")
    .get(id) as { retry_count: number } | undefined;

  const retryCount = (job?.retry_count ?? 0) + 1;
  kb.sqlite.run(
    "UPDATE knowledge_jobs SET status = 'failed', error = ?, retry_count = ?, updated_at = ? WHERE id = ?",
    [error, retryCount, now, id],
  );
}

function safeJsonParse(raw: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}
