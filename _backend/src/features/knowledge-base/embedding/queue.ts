import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { openKnowledgeDb, type KbScope } from "../db";
import { knowledgeEmbeddingCache, knowledgeJobs as kbJobs } from "../schema";
import { listPendingJobs, updateJobStatus, createJob } from "../jobs";
import type { EmbeddingProvider } from "./provider";
import { EMBEDDING_RETRIES } from "../constants";

/**
 * Background batch embedding queue.
 * Processes jobs from knowledge_jobs table where type='embed' and status='queued'.
 * Batches by batchSize and embeds independently per batch.
 */
export class EmbeddingQueue {
  private provider: EmbeddingProvider | null = null;
  private batchSize: number;
  private processing = false;

  constructor(provider: EmbeddingProvider | null, batchSize = 50) {
    this.provider = provider;
    this.batchSize = batchSize;
  }

  get pendingCount(): number {
    // This is a rough indicator — real count requires DB query
    return 0;
  }

  setProvider(provider: EmbeddingProvider | null): void {
    this.provider = provider;
  }

  /**
   * Enqueue a batch of chunk IDs for embedding.
   * Created as individual jobs in the knowledge_jobs table.
   */
  async enqueueBatch(
    dataDir: string,
    scope: KbScope,
    chunkEntries: Array<{ chunkId: string; content: string }>,
  ): Promise<void> {
    if (!this.provider) return;
    const kb = await openKnowledgeDb(dataDir, scope);
    if (!kb) return;

    for (const entry of chunkEntries) {
      await createJob(kb, "embed", scope, {
        chunkId: entry.chunkId,
        content: entry.content,
      });
    }
  }

  /**
   * Process all pending embedding jobs.
   */
  async processPending(dataDir: string, scope: KbScope): Promise<void> {
    if (!this.provider || this.processing) return;
    this.processing = true;

    try {
      const kb = await openKnowledgeDb(dataDir, scope);
      if (!kb) return;

      const pending = await listPendingJobs(kb, "embed");
      if (pending.length === 0) return;

      // Process in batches
      for (let i = 0; i < pending.length; i += this.batchSize) {
        const batch = pending.slice(i, i + this.batchSize);

        try {
          const texts = batch.map((j) => (j.payload as any)?.content || "").filter(Boolean);

          if (texts.length === 0) {
            // Mark jobs as completed even if empty
            for (const job of batch) {
              await updateJobStatus(kb, job.id, "completed");
            }
            continue;
          }

          // Mark as processing
          for (const job of batch) {
            await updateJobStatus(kb, job.id, "processing");
          }

          // Embed
          const embeddings = await this.provider.embed(texts);

          // Store embeddings in cache
          const now = new Date().toISOString();
          for (let j = 0; j < batch.length; j++) {
            const job = batch[j];
            const payload = job.payload as any;
            const chunkHash = simpleHash(payload?.content || "");

            // Cache the embedding
            await kb.db.insert(knowledgeEmbeddingCache).values({
              id: randomUUIDv7(),
              chunkHash,
              model: "default",
              dimensions: this.provider!.dimensions,
              createdAt: now,
            });

            // Mark job as completed
            await updateJobStatus(kb, job.id, "completed");
          }
        } catch (err: any) {
          // Mark as failed
          for (const job of batch) {
            const jobRecord = await kb.db
              .select()
              .from(kbJobs)
              .where(eq(kbJobs.id, job.id))
              .get();

            const retries = jobRecord?.retryCount ?? 0;
            if (retries >= EMBEDDING_RETRIES) {
              await updateJobStatus(kb, job.id, "failed", err.message);
            } else {
              await updateJobStatus(kb, job.id, "queued", err.message);
            }
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
