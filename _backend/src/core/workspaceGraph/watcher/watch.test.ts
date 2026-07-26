import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startWorkspaceWatcher } from "./watch";

function freshDir() {
  const dir = join(tmpdir(), "wg-watch-" + randomUUID());
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("workspaceGraph watcher", () => {
  it("batches rapid file changes into one async processing cycle", async () => {
    const workspaceRoot = freshDir();
    const batches: string[][] = [];

    const watcher = await startWorkspaceWatcher({
      workspaceRoot,
      debounceMs: 50,
      onBatch: async (events) => {
        batches.push(events.map((e) => e.path));
      },
    });

    writeFileSync(join(workspaceRoot, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(workspaceRoot, "src/b.ts"), "export const b = 2;\n");

    await wait(200);

    expect(batches.length).toBe(1);
    const flat = batches[0].sort();
    expect(flat).toContain("src/a.ts");
    expect(flat).toContain("src/b.ts");

    await watcher.close();
  });

  it("ignores .vsh and node_modules events", async () => {
    const workspaceRoot = freshDir();
    const batches: string[][] = [];

    const watcher = await startWorkspaceWatcher({
      workspaceRoot,
      debounceMs: 50,
      onBatch: async (events) => {
        batches.push(events.map((e) => e.path));
      },
    });

    mkdirSync(join(workspaceRoot, ".vsh"), { recursive: true });
    writeFileSync(join(workspaceRoot, ".vsh/graph.db"), "data\n");

    // Trigger valid change too to ensure watcher runs
    writeFileSync(join(workspaceRoot, "src/real.ts"), "export const real = true;\n");

    await wait(200);

    for (const batch of batches) {
      for (const path of batch) {
        expect(path).not.toContain(".vsh");
        expect(path).not.toContain("node_modules");
      }
    }

    await watcher.close();
  });
});