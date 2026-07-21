import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, listSessions, listChildSessions } from "./session";
import type { SessionMeta } from "../../../_shared/types";

let dataDir = "";

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vsh-sess-"));
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("session list filters", () => {
  test("hides subagents by default and lists children", async () => {
    const parent: SessionMeta = {
      id: "parent1",
      title: "Parent",
      providerName: "P",
      modelName: "M",
      workspaceRoot: "/tmp",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      kind: "primary",
    };
    const child: SessionMeta = {
      id: "child1",
      title: "Sub: explore",
      providerName: "P",
      modelName: "M",
      workspaceRoot: "/tmp",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      kind: "subagent",
      parentId: "parent1",
      taskLabel: "explore",
    };
    await createSession(dataDir, parent);
    await createSession(dataDir, child);

    const listed = await listSessions(dataDir);
    expect(listed.map((s) => s.id)).toEqual(["parent1"]);

    const all = await listSessions(dataDir, { includeSubagents: true });
    expect(all.map((s) => s.id).sort()).toEqual(["child1", "parent1"]);

    const kids = await listChildSessions(dataDir, "parent1");
    expect(kids).toHaveLength(1);
    expect(kids[0].id).toBe("child1");
  });
});
