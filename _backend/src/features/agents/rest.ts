import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AgentSettings } from "../../../_shared/types";

function agentsDir(dataDir: string): string {
  return join(dataDir, "agents");
}

function agentPath(dataDir: string, key: string): string {
  return join(agentsDir(dataDir), `${key}.json`);
}

async function ensureDir(dir: string) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export type AgentFile = {
  key: string;
  settings: AgentSettings;
};

export async function listAgents(dataDir: string): Promise<AgentFile[]> {
  const dir = agentsDir(dataDir);
  await ensureDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: AgentFile[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".json")) {
      const key = e.name.slice(0, -5);
      try {
        const raw = await readFile(join(dir, e.name), "utf-8");
        const settings = JSON.parse(raw) as AgentSettings;
        results.push({ key, settings });
      } catch {
        // skip unreadable
      }
    }
  }
  return results.sort((a, b) => a.key.localeCompare(b.key));
}

export async function readAgent(dataDir: string, key: string): Promise<AgentSettings | null> {
  const fp = agentPath(dataDir, key);
  try {
    const raw = await readFile(fp, "utf-8");
    return JSON.parse(raw) as AgentSettings;
  } catch {
    return null;
  }
}

export async function writeAgent(dataDir: string, key: string, settings: AgentSettings): Promise<void> {
  const dir = agentsDir(dataDir);
  await ensureDir(dir);
  await writeFile(agentPath(dataDir, key), JSON.stringify(settings, null, 2) + "\n");
}

export async function deleteAgentFile(dataDir: string, key: string): Promise<void> {
  const fp = agentPath(dataDir, key);
  try {
    await unlink(fp);
  } catch {
    // ignore if gone
  }
}

export function registerAgentsRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/agents", async () => {
    return listAgents(dataDir);
  });

  app.put("/api/agents/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as AgentSettings;
    if (!body) return reply.code(400).send({ error: "body required" });
    await writeAgent(dataDir, key, body);
    return { ok: true };
  });

  app.delete("/api/agents/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    await deleteAgentFile(dataDir, key);
    return { ok: true };
  });
}
