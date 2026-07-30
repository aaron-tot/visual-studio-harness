import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { randomUUIDv7 } from "bun";
import { openKnowledgeDb, type KbScope } from "../db";
import { knowledgeEmbeddingCache, knowledgeJobs as kbJobs, knowledgeChunks } from "../schema";
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

          // Store embeddings in vec0 table and cache
          const now = new Date().toISOString();
          for (let j = 0; j < batch.length; j++) {
            const job = batch[j];
            const payload = job.payload as any;
            const content = payload?.content || "";
            const chunkHash = createHash("sha256").update(content).digest("hex");

            // Cache the embedding (for dedup)
            await kb.db.insert(knowledgeEmbeddingCache).values({
              id: randomUUIDv7(),
              chunkHash,
              model: this.provider!.modelName,
              dimensions: this.provider!.dimensions,
              createdAt: now,
            });

            // Store vector in vec0 table for search
            if (embeddings[j]) {
              const embeddingArr = new Float32Array(embeddings[j]);
              const embeddingStr = `[${Array.from(embeddingArr).join(",")}]`;
              try {
                kb.sqlite.run(
                  "INSERT INTO knowledge_embeddings(chunk_id, embedding) VALUES (?, ?)",
                  [payload.chunkId, embeddingStr],
                );

                // Update chunk's embedding_model field
                await kb.db
                  .update(knowledgeChunks)
                  .set({ embeddingModel: this.provider!.modelName })
                  .where(eq(knowledgeChunks.id, payload.chunkId));
              } catch (vecErr: any) {
                console.warn("[knowledge] Failed to store vector embedding:", vecErr.message);
              }
            }

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
