import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { openKnowledgeDb, type KbScope } from "../db";
import { knowledgeEmbeddingCache, knowledgeEmbeddingMeta, knowledgeJobs as kbJobs, knowledgeChunks } from "../schema";
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
   * Throws if there are pending jobs but no provider is available — a job
   * that can never be embedded must surface, not sit silently in the queue.
   */
  async processPending(dataDir: string, scope: KbScope): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const kb = await openKnowledgeDb(dataDir, scope);
      if (!kb) return;

      const pending = await listPendingJobs(kb, "embed");
      if (pending.length === 0) return;

      if (!this.provider) {
        throw new Error(
          `${pending.length} embed job(s) are pending but no embedding provider is available. ` +
            `Check knowledge.embedding.providerId in config.`,
        );
      }

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

          // Embed (transient API errors retry inside the provider).
          const embeddings = await this.provider.embed(texts);

          // Store embeddings in vec0 table and cache
          const now = new Date().toISOString();
          for (let j = 0; j < batch.length; j++) {
            const job = batch[j];
            const payload = job.payload as any;
            const content = payload?.content || "";
            const chunkHash = createHash("sha256").update(content).digest("hex");

            try {
              // Cache the embedding (for dedup) — ignore conflicts on repeat content
              await kb.db.insert(knowledgeEmbeddingCache).values({
                id: randomUUIDv7(),
                chunkHash,
                model: this.provider!.modelName,
                dimensions: this.provider!.dimensions,
                createdAt: now,
              }).onConflictDoNothing();

              // Record embedding metadata (per chunk hash)
              await kb.db.insert(knowledgeEmbeddingMeta).values({
                id: randomUUIDv7(),
                chunkHash,
                model: this.provider!.modelName,
                dimensions: this.provider!.dimensions,
                tokenCount: 0,
                createdAt: now,
              }).onConflictDoNothing();

              // Store vector in vec0 table for search
              if (embeddings[j]) {
                const embeddingArr = new Float32Array(embeddings[j]);
                const embeddingStr = `[${Array.from(embeddingArr).join(",")}]`;
                kb.sqlite.run(
                  "INSERT INTO knowledge_embeddings(chunk_id, embedding) VALUES (?, ?)",
                  [payload.chunkId, embeddingStr],
                );

                // Update chunk's embedding_model field
                await kb.db
                  .update(knowledgeChunks)
                  .set({ embeddingModel: this.provider!.modelName })
                  .where(eq(knowledgeChunks.id, payload.chunkId));
              }

              // Mark job as completed
              await updateJobStatus(kb, job.id, "completed");
            } catch (storeErr: any) {
              // Storage failed (e.g. vec0 insert) — retry the job, don't mark it done.
              await this.markJobRetry(kb, job.id, storeErr);
            }
          }
        } catch (err: any) {
          // Batch embed failed — mark every job for retry/failure.
          for (const job of batch) {
            await this.markJobRetry(kb, job.id, err);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async markJobRetry(kb: Awaited<ReturnType<typeof openKnowledgeDb>>, jobId: string, err: any): Promise<void> {
    if (!kb) return;
    const jobRecord = await kb.db
      .select()
      .from(kbJobs)
      .where(eq(kbJobs.id, jobId))
      .get();

    const retries = jobRecord?.retryCount ?? 0;
    if (retries >= EMBEDDING_RETRIES) {
      await updateJobStatus(kb, jobId, "failed", err.message);
    } else {
      await updateJobStatus(kb, jobId, "queued", err.message, retries + 1);
    }
  }
}
