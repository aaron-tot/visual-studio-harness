import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AuditPrompt } from "../../../_shared/types/audit";
import { SEED_PROMPTS } from "./audit-prompt-seeds";
import { localISOString } from "../utils/datetime";

const PROMPTS_DIR = "audit-prompts";

// ── Helpers ──────────────────────────────────────────────────────────

export function resolveAuditPromptsDir(dataDir: string): string {
  return join(dataDir, PROMPTS_DIR);
}

export async function readPromptFile(dir: string): Promise<AuditPrompt | null> {
  try {
    const raw = await readFile(join(dir, "prompt.json"), "utf-8");
    return JSON.parse(raw) as AuditPrompt;
  } catch {
    return null;
  }
}

export interface AuditPromptEntry {
  id: string;
  path: string;
  prompt: AuditPrompt;
}

export async function seedPromptsIfNeeded(promptsDir: string): Promise<void> {
  if (!existsSync(promptsDir)) {
    await mkdir(promptsDir, { recursive: true });
  }
  const existing = await readdir(promptsDir, { withFileTypes: true });
  const existingNames = new Set(
    existing.filter((e) => e.isDirectory()).map((e) => e.name)
  );
  for (const p of SEED_PROMPTS) {
    if (existingNames.has(p.id)) continue;
    const nd = join(promptsDir, p.id);
    await mkdir(nd, { recursive: true });
    await writeFile(join(nd, "prompt.json"), JSON.stringify(p, null, 2) + "\n");
  }
}

export async function listPromptEntries(
  promptsDir: string
): Promise<AuditPromptEntry[]> {
  await seedPromptsIfNeeded(promptsDir);
  const entries = await readdir(promptsDir, { withFileTypes: true });
  const results: AuditPromptEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pd = join(promptsDir, e.name);
    const prompt = await readPromptFile(pd);
    if (!prompt) continue;
    results.push({ id: e.name, path: pd, prompt });
  }
  return results.sort((a, b) => a.prompt.name.localeCompare(b.prompt.name));
}

export interface CreatePromptParams {
  id: string;
  name: string;
  description: string;
  category: "general" | "implementation";
  auditType: string;
  endGoal?: string;
  templateInstructions: string;
}

export async function createPrompt(
  promptsDir: string,
  params: CreatePromptParams
): Promise<{ prompt: AuditPrompt; path: string }> {
  const nd = join(promptsDir, params.id);
  if (existsSync(nd)) throw new Error("prompt id already exists");
  const now = localISOString();
  const prompt: AuditPrompt = {
    id: params.id,
    name: params.name,
    description: params.description,
    category: params.category,
    auditType: params.auditType as AuditPrompt["auditType"],
    endGoal: params.endGoal || undefined,
    templateInstructions: params.templateInstructions,
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(nd, { recursive: true });
  await writeFile(join(nd, "prompt.json"), JSON.stringify(prompt, null, 2) + "\n");
  return { prompt, path: nd };
}

export async function readPrompt(
  promptsDir: string,
  id: string
): Promise<{ prompt: AuditPrompt; path: string } | null> {
  const nd = join(promptsDir, id);
  if (!existsSync(nd)) return null;
  const prompt = await readPromptFile(nd);
  if (!prompt) return null;
  return { prompt, path: nd };
}

export async function editPrompt(
  promptsDir: string,
  id: string,
  updates: {
    name?: string;
    description?: string;
    category?: "general" | "implementation";
    auditType?: string;
    endGoal?: string;
    templateInstructions?: string;
  }
): Promise<{ prompt: AuditPrompt; path: string } | null> {
  const nd = join(promptsDir, id);
  if (!existsSync(nd)) return null;
  const existing = await readPromptFile(nd);
  if (!existing) return null;
  const updated: AuditPrompt = {
    ...existing,
    ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
    ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
    ...(updates.category !== undefined ? { category: updates.category } : {}),
    ...(updates.auditType !== undefined ? { auditType: updates.auditType as AuditPrompt["auditType"] } : {}),
    ...(updates.endGoal !== undefined ? { endGoal: updates.endGoal.trim() || undefined } : {}),
    ...(updates.templateInstructions !== undefined ? { templateInstructions: updates.templateInstructions.trim() } : {}),
    updatedAt: localISOString(),
  };
  await writeFile(join(nd, "prompt.json"), JSON.stringify(updated, null, 2) + "\n");
  return { prompt: updated, path: nd };
}

export async function deletePrompt(
  promptsDir: string,
  id: string
): Promise<boolean> {
  const nd = join(promptsDir, id);
  if (!existsSync(nd)) return false;
  await rm(nd, { recursive: true, force: true });
  return true;
}

// ── Routes ───────────────────────────────────────────────────────────

export function registerAuditPromptsRoutes(
  app: FastifyInstance,
  dataDir: string
) {
  const promptsDir = resolveAuditPromptsDir(dataDir);

  app.addHook("onReady", async () => {
    await seedPromptsIfNeeded(promptsDir);
  });

  app.get("/api/audit-prompts", async () => {
    const entries = await listPromptEntries(promptsDir);
    return { prompts: entries };
  });

  app.post<{
    Body: {
      id: string;
      name: string;
      description?: string;
      category?: string;
      auditType?: string;
      endGoal?: string;
      templateInstructions: string;
    };
  }>("/api/audit-prompts/create", async (request, reply) => {
    const { id, name, description, category, auditType, endGoal, templateInstructions } = request.body;
    if (!id?.trim()) return reply.code(400).send({ error: "id is required" });
    if (!name?.trim()) return reply.code(400).send({ error: "name is required" });
    if (!templateInstructions?.trim()) return reply.code(400).send({ error: "templateInstructions is required" });
    try {
      const result = await createPrompt(promptsDir, {
        id: id.trim(),
        name: name.trim(),
        description: description?.trim() || "",
        category: category === "implementation" ? "implementation" as const : "general" as const,
        auditType: auditType || "custom",
        endGoal: endGoal?.trim() || undefined,
        templateInstructions: templateInstructions.trim(),
      });
      return { ok: true, path: result.path, prompt: result.prompt };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message || "prompt id already exists" });
    }
  });

  app.post<{ Body: { id: string } }>("/api/audit-prompts/read", async (request, reply) => {
    const { id } = request.body;
    if (!id?.trim()) return reply.code(400).send({ error: "id is required" });
    const result = await readPrompt(promptsDir, id.trim());
    if (!result) return reply.code(404).send({ error: "prompt not found" });
    return result;
  });

  app.put<{
    Body: {
      id: string;
      name?: string;
      description?: string;
      category?: string;
      auditType?: string;
      endGoal?: string;
      templateInstructions?: string;
    };
  }>("/api/audit-prompts/edit", async (request, reply) => {
    const { id, ...updates } = request.body;
    if (!id?.trim()) return reply.code(400).send({ error: "id is required" });
    const result = await editPrompt(promptsDir, id.trim(), {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.category !== undefined ? { category: updates.category as "general" | "implementation" } : {}),
      ...(updates.auditType !== undefined ? { auditType: updates.auditType } : {}),
      ...(updates.endGoal !== undefined ? { endGoal: updates.endGoal } : {}),
      ...(updates.templateInstructions !== undefined ? { templateInstructions: updates.templateInstructions } : {}),
    });
    if (!result) return reply.code(404).send({ error: "prompt not found" });
    return { ok: true, ...result };
  });

  app.delete<{ Body: { id: string } }>("/api/audit-prompts/delete", async (request, reply) => {
    const { id } = request.body;
    if (!id?.trim()) return reply.code(400).send({ error: "id is required" });
    const ok = await deletePrompt(promptsDir, id.trim());
    if (!ok) return reply.code(404).send({ error: "prompt not found" });
    return { ok: true };
  });
}
