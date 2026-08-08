import { describe, it, expect, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeTool } from "../consolidated/knowledge";
import { knowledgeDocumentMoveTool } from "../builtins/knowledge_document_move";
import { setKbService } from "../builtins/knowledge_common";
import { KnowledgeBaseService } from "../../knowledge-base/knowledge-base-service";
import { closeAllKnowledgeDbs } from "../../knowledge-base/db";

const roots: string[] = [];

afterAll(async () => {
  closeAllKnowledgeDbs();
  setKbService(null as any); // restore pristine default (uninitialized) so sibling tests see "service not initialized"
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe("knowledge move action", () => {
  it("exposes 'move' in the action enum", () => {
    const schema = knowledgeTool.inputSchema as any;
    const values = schema.shape.action._def.values as string[];
    expect(values).toContain("move");
  });

  it("requires toScope + documentId/filename for move; keeps fromScope optional", () => {
    const schema = knowledgeTool.inputSchema as any;
    expect(schema.safeParse({ action: "move" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", toScope: "session" }).success).toBe(false);
    expect(schema.safeParse({ action: "move", documentId: "abc", toScope: "session" }).success).toBe(true);
    expect(schema.safeParse({ action: "move", documentId: "abc", fromScope: "global", toScope: "global" }).success).toBe(false);
  });

  it("move tool errors when KB service not initialized", async () => {
    setKbService(null as any);
    const res = await knowledgeDocumentMoveTool.execute(
      { documentId: "abc", toScope: "session" },
      { dataDir: "/tmp", sessionId: "s1", workspaceRoot: "/tmp" } as any,
    );
    expect(res.isError).toBe(true);
    expect(res.output).toContain("not initialized");
  });

  it("requires documentId or filename at runtime", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vsh-kb-move-"));
    roots.push(dataDir);
    setKbService(new KnowledgeBaseService(dataDir));
    const res = await knowledgeDocumentMoveTool.execute(
      { toScope: "session" },
      { dataDir, sessionId: "s1", workspaceRoot: "/tmp" } as any,
    );
    expect(res.isError).toBe(true);
    expect(res.output).toContain("documentId or filename is required");
  });
});
