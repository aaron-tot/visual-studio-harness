/**
 * Builtin `customTool` tool — self-contained ctx entry.
 * Manages user-defined custom tools stored at `data/tools/custom/<name>/`
 * (the unified folder-per-tool shape: `<name>.json` ToolConfig + `index.js`
 * entry + optional `skill.md`/`prompt.json`).
 * list/read/write/delete are implemented directly over node:fs because the
 * custom-tools store is not exposed on `ctx.services` yet.
 */
import { readFile, writeFile, readdir, unlink, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ACTIONS = ["create", "read", "update", "delete", "list"] as const;
type Action = (typeof ACTIONS)[number];

/** Entry file name inside the folder-per-tool shape (the code IS this file). */
const ENTRY = "index.js";

/** Wrap a bare function body (the `code` a user authors) into an entry module. */
const ENTRY_MODULE_RE = /^export\s+(?:async\s+)?function\s+execute\b/s;
function codeToEntryModule(code: string): string {
  const trimmed = (code ?? "").trim();
  if (ENTRY_MODULE_RE.test(trimmed)) return code;
  return `export async function execute(args, ctx) {\n${code}\n}\n`;
}

function toolsDir(dataDir: string): string {
  return join(resolve(dataDir), "tools", "custom");
}

function toolDir(dataDir: string, name: string): string {
  return join(toolsDir(dataDir), name);
}

function toolPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), `${name}.json`);
}

function entryPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), ENTRY);
}

function skillPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), "skill.md");
}

function promptPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), "prompt.json");
}

async function ensureCustomToolsDir(dataDir: string): Promise<void> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

interface CustomToolRecord {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  enabled: boolean;
  permissionDefault?: "allow" | "ask" | "deny";
  skillGuide?: string;
  skillPushMode?: "soft" | "hard" | "custom";
  skillId?: string;
  skillCustomPushText?: string;
  skillTags?: string[];
}

/** Read a folder-per-tool record: `<name>.json` (ToolConfig) + `index.js` (code). */
async function readRecord(dataDir: string, name: string): Promise<CustomToolRecord | null> {
  const fp = toolPath(dataDir, name);
  try {
    const cfg = JSON.parse(await readFile(fp, "utf-8")) as Record<string, unknown>;
    const code = await readFile(entryPath(dataDir, name), "utf-8").catch(() => "");
    const skillGuide = await readFile(skillPath(dataDir, name), "utf-8").catch(() => null);
    const skill = (cfg.skill ?? {}) as Record<string, unknown>;
    let skillTags: string[] = [];
    try {
      const prompt = JSON.parse(await readFile(promptPath(dataDir, name), "utf-8")) as { tags?: unknown };
      if (Array.isArray(prompt.tags)) skillTags = prompt.tags.filter((t): t is string => typeof t === "string");
    } catch {}
    const record: CustomToolRecord = {
      name: String(cfg.name ?? name),
      description: String(cfg.description ?? ""),
      inputSchema: (cfg.inputSchema as Record<string, unknown>) ?? {},
      code,
      enabled: cfg.enabled !== false,
      permissionDefault: (cfg.permissionDefault as CustomToolRecord["permissionDefault"]) ?? "ask",
    };
    if (skillGuide ?? (skill.guide as string | undefined)) {
      record.skillGuide = (skillGuide ?? skill.guide) as string;
      record.skillPushMode = (skill.pushMode as CustomToolRecord["skillPushMode"]) ?? "soft";
      record.skillId = (skill.id as string | undefined) ?? String(cfg.name ?? name);
      record.skillCustomPushText = skill.customPushText as string | undefined;
    }
    if (skillTags.length > 0) record.skillTags = skillTags;
    else if (Array.isArray(skill.tags)) record.skillTags = skill.tags.filter((t): t is string => typeof t === "string");
    return record;
  } catch {
    return null;
  }
}

async function readSkillGuide(dataDir: string, name: string): Promise<string | null> {
  try {
    return await readFile(skillPath(dataDir, name), "utf-8");
  } catch {
    return null;
  }
}

async function writeRecord(dataDir: string, tool: CustomToolRecord): Promise<void> {
  await ensureCustomToolsDir(dataDir);
  await mkdir(toolDir(dataDir, tool.name), { recursive: true });

  const cfg: Record<string, unknown> = {
    name: tool.name,
    description: tool.description,
    entry: ENTRY,
    inputSchema: tool.inputSchema,
    enabled: tool.enabled !== false,
    permissionDefault: tool.permissionDefault ?? "ask",
  };
  if (tool.skillGuide) {
    cfg.skill = {
      guide: tool.skillGuide,
      pushMode: tool.skillPushMode ?? "soft",
      id: tool.skillId ?? tool.name,
      tags: Array.isArray(tool.skillTags) && tool.skillTags.length > 0 ? tool.skillTags : undefined,
      customPushText: tool.skillCustomPushText,
    };
  }
  await writeFile(toolPath(dataDir, tool.name), JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  await writeFile(entryPath(dataDir, tool.name), codeToEntryModule(tool.code), "utf-8");

  if (tool.skillGuide) {
    await writeFile(skillPath(dataDir, tool.name), tool.skillGuide, "utf-8");
  } else {
    await unlink(skillPath(dataDir, tool.name)).catch(() => {});
  }
  if (tool.skillGuide && Array.isArray(tool.skillTags) && tool.skillTags.length > 0) {
    await writeFile(promptPath(dataDir, tool.name), JSON.stringify({ tags: tool.skillTags }, null, 2) + "\n", "utf-8");
  } else {
    await unlink(promptPath(dataDir, tool.name)).catch(() => {});
  }
}

async function listCustomTools(dataDir: string): Promise<CustomToolRecord[]> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tools: CustomToolRecord[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (!existsSync(toolPath(dataDir, name))) continue;
    const record = await readRecord(dataDir, name);
    if (record) tools.push(record);
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const action = args.action as Action | undefined;
  const dataDir = ctx.dataDir;
  if (!dataDir) {
    return { title: "Error", output: "ERROR customTool: dataDir not available", isError: true };
  }

  await ensureCustomToolsDir(dataDir);

  try {
    switch (action) {
      case "list": {
        const tools = await listCustomTools(dataDir);
        return {
          title: "Custom Tools List",
          output: JSON.stringify(
            tools.map((t) => ({
              name: t.name,
              description: t.description,
              enabled: t.enabled,
              skillId: t.skillId,
              skillPushMode: t.skillPushMode,
            })),
            null,
            2
          ),
          metadata: { action: "list", count: tools.length },
        };
      }

      case "create": {
        const name = String(args.name ?? "");
        if (!args.name) {
          return { title: "Error", output: "ERROR customTool: name is required for create", isError: true };
        }
        if (!SAFE_NAME.test(name)) {
          return {
            title: "Error",
            output: "ERROR customTool: invalid name (alphanumeric, hyphens, underscores; 1-64 chars)",
            isError: true,
          };
        }
        if (!String(args.code ?? "").trim()) {
          return { title: "Error", output: "ERROR customTool: code is required for create", isError: true };
        }
        if (!String(args.description ?? "").trim()) {
          return { title: "Error", output: "ERROR customTool: description is required for create", isError: true };
        }

        const existing = await readRecord(dataDir, name);
        if (existing) {
          return { title: "Error", output: `ERROR customTool: tool "${name}" already exists`, isError: true };
        }

        let inputSchema: Record<string, unknown>;
        try {
          inputSchema =
            args.inputSchema && typeof args.inputSchema === "object"
              ? (args.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} };
        } catch {
          return { title: "Error", output: "ERROR customTool: invalid inputSchema", isError: true };
        }

        const tool: CustomToolRecord = {
          name,
          description: String(args.description ?? "").trim(),
          inputSchema,
          code: String(args.code).trim(),
          enabled: args.enabled !== false,
          permissionDefault: args.permissionDefault ?? "ask",
          skillGuide:
            typeof args.skillGuide === "string" && args.skillGuide.trim() ? args.skillGuide.trim() : undefined,
          skillPushMode: args.skillPushMode as CustomToolRecord["skillPushMode"],
          skillId: typeof args.skillId === "string" && args.skillId.trim() ? args.skillId.trim() : undefined,
          skillCustomPushText:
            typeof args.skillCustomPushText === "string" && args.skillCustomPushText.trim()
              ? args.skillCustomPushText.trim()
              : undefined,
          skillTags: Array.isArray(args.skillTags) ? args.skillTags.map(String) : undefined,
        };

        await writeRecord(dataDir, tool);

        return {
          title: `Created: ${name}`,
          output: `Custom tool "${name}" created successfully.`,
          metadata: { action: "create", tool },
        };
      }

      case "read": {
        if (!args.name) {
          return { title: "Error", output: "ERROR customTool: name is required for read", isError: true };
        }
        const tool = await readRecord(dataDir, String(args.name));
        if (!tool) {
          return {
            title: "Error",
            output: `ERROR customTool: tool "${args.name}" not found`,
            isError: true,
          };
        }
        return {
          title: `Tool: ${args.name}`,
          output: JSON.stringify(tool, null, 2),
          metadata: { action: "read", tool },
        };
      }

      case "update": {
        const name = String(args.name ?? "");
        if (!args.name) {
          return { title: "Error", output: "ERROR customTool: name is required for update", isError: true };
        }
        const existing = await readRecord(dataDir, name);
        if (!existing) {
          return {
            title: "Error",
            output: `ERROR customTool: tool "${name}" not found`,
            isError: true,
          };
        }

        let inputSchema: Record<string, unknown> | undefined;
        if (args.inputSchema !== undefined) {
          try {
            inputSchema = args.inputSchema as Record<string, unknown>;
          } catch {
            return { title: "Error", output: "ERROR customTool: invalid inputSchema", isError: true };
          }
        }

        const updated: CustomToolRecord = {
          ...existing,
          description:
            typeof args.description === "string" && args.description.trim()
              ? args.description.trim()
              : existing.description,
          inputSchema: args.inputSchema !== undefined ? inputSchema : existing.inputSchema,
          code: typeof args.code === "string" && args.code.trim() ? args.code.trim() : existing.code,
          enabled: args.enabled !== undefined ? Boolean(args.enabled) : existing.enabled,
          permissionDefault: (args.permissionDefault ?? existing.permissionDefault) as CustomToolRecord["permissionDefault"],
          skillGuide:
            args.skillGuide !== undefined
              ? typeof args.skillGuide === "string" && args.skillGuide.trim()
                ? args.skillGuide.trim()
                : undefined
              : existing.skillGuide,
          skillPushMode: (args.skillPushMode ?? existing.skillPushMode) as CustomToolRecord["skillPushMode"],
          skillId:
            args.skillId !== undefined
              ? typeof args.skillId === "string" && args.skillId.trim()
                ? args.skillId.trim()
                : undefined
              : existing.skillId,
          skillCustomPushText:
            args.skillCustomPushText !== undefined
              ? typeof args.skillCustomPushText === "string" && args.skillCustomPushText.trim()
                ? args.skillCustomPushText.trim()
                : undefined
              : existing.skillCustomPushText,
          skillTags: args.skillTags !== undefined ? args.skillTags.map(String) : existing.skillTags,
        };

        await writeRecord(dataDir, updated);

        return {
          title: `Updated: ${name}`,
          output: `Custom tool "${name}" updated successfully.`,
          metadata: { action: "update", tool: updated },
        };
      }

      case "delete": {
        if (!args.name) {
          return { title: "Error", output: "ERROR customTool: name is required for delete", isError: true };
        }
        const name = String(args.name);
        const existing = await readRecord(dataDir, name);
        if (!existing) {
          return { title: "Error", output: `ERROR customTool: tool "${name}" not found`, isError: true };
        }
        await rm(toolDir(dataDir, name), { recursive: true, force: true });
        return {
          title: `Deleted: ${name}`,
          output: `Custom tool "${name}" deleted successfully.`,
          metadata: { action: "delete", name },
        };
      }

      default:
        return {
          title: "Error",
          output: `ERROR customTool: unknown action "${String(action)}"`,
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { title: "Error", output: `ERROR customTool: ${msg}`, isError: true };
  }
}
