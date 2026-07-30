import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { KnowledgeBaseConfig } from "../../../../_shared/types/config";
import { openKnowledgeDb, closeAllKnowledgeDbs, type KbScope } from "./db";

export class KnowledgeBaseService {
  private readonly dataDir: string;
  private initialized = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async init(config: KnowledgeBaseConfig | undefined): Promise<void> {
    if (!config?.enabled) {
      console.log("[knowledge] disabled by config");
      return;
    }

    console.log("[knowledge] initializing...");

    // Ensure source directories exist for all scopes
    const scopes: { scope: KbScope; workspaceRoot?: string; sessionId?: string }[] = [
      { scope: "global" },
    ];

    for (const { scope } of scopes) {
      const sourcesDir = join(this.dataDir, "knowledge", "sources");
      await mkdir(sourcesDir, { recursive: true });

      // Open DB to initialize tables
      const kbDb = await openKnowledgeDb(this.dataDir, scope);
      if (kbDb) {
        console.log(`[knowledge] ${scope} DB ready at ${kbDb.path}`);
      }
    }

    this.initialized = true;
    console.log("[knowledge] initialized");
  }

  async destroy(): Promise<void> {
    if (!this.initialized) return;
    closeAllKnowledgeDbs();
    this.initialized = false;
    console.log("[knowledge] destroyed");
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
