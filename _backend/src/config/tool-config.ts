import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ToolConfig } from "../../../_shared/types";
import { SearchProviderConfigSchema, SlotBusyPolicySchema } from "./schema";

const PermissionDefaultSchema = z.enum(["allow", "ask", "deny"]);

const ToolTimeoutsSchema = z.object({
  minMs: z.number().int().nonnegative().optional(),
  maxMs: z.number().int().positive().optional(),
  defaultMs: z.number().int().positive().optional(),
  minSec: z.number().int().nonnegative().optional(),
  maxSec: z.number().int().positive().optional(),
  defaultSec: z.number().int().positive().optional(),
});

const ToolSubagentSchema = z.object({
  slotBusyPolicy: SlotBusyPolicySchema.optional(),
  pollIntervalSec: z.number().int().positive().optional(),
  waitTimeoutSec: z.number().int().min(0).optional(),
});

const ToolSkillSchema = z.object({
  guide: z.string(),
  pushMode: z.enum(["soft", "hard", "custom"]),
  id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customPushText: z.string().optional(),
});

/** Schema for the `<name>.json` inside each tool folder. */
export const ToolConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  entry: z.string().regex(/^[^/\\]+$/, "entry must be a bare filename").min(1),
  inputSchema: z.record(z.unknown()),
  enabled: z.boolean(),
  permissionDefault: PermissionDefaultSchema,
  timeouts: ToolTimeoutsSchema.optional(),
  externalAccess: z.boolean().optional(),
  subagent: ToolSubagentSchema.optional(),
  searchProviders: z.array(SearchProviderConfigSchema).optional(),
  skill: ToolSkillSchema.optional(),
});

/**
 * Read and validate a single tool `<name>.json` from disk.
 * Returns the validated ToolConfig; throws on missing file, invalid JSON,
 * or schema violations.
 */
export async function readToolConfig(jsonPath: string): Promise<ToolConfig> {
  const raw = await readFile(jsonPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return ToolConfigSchema.parse(parsed);
}
