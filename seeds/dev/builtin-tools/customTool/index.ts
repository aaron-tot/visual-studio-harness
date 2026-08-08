/**
 * Builtin `customTool` tool — self-contained ctx entry.
 * Manages user-defined custom tools stored at `dataDir/custom-tools/` (the
 * pre-migration location; the move to `data/tools/custom/` is a later task).
 * list/read/write/delete are implemented directly over node:fs because the
 * custom-tools store is not exposed on `ctx.services` yet.
 */
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ACTIONS = ["create", "read", "update", "delete", "list"] as const;
type Action = (typeof ACTIONS)[number];

function toolsDir(dataDir: string): string {
  return join(resolve(dataDir), "custom-tools");
}

function toolPath(dataDir: string, name: string): string {
  return join(toolsDir(dataDir), `${name}.json`);
}

function skillPath(dataDir: string, name: string): string {
  return join(toolsDir(dataDir), `${name}.skill.md`);
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

async function listCustomTools(dataDir: string): Promise<CustomToolRecord[]> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tools: CustomToolRecord[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name.endsWith(".prompt.json")) continue;
    try {
      const raw = await readFile(join(dir, e.name), "utf-8");
      const parsed = JSON.parse(raw) as CustomToolRecord;
      tools.push(parsed);
    } catch {
      // skip unreadable
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

async function readCustomTool(dataDir: string, name: string): Promise<CustomToolRecord | null> {
  const fp = toolPath(dataDir, name);
  try {
    const raw = await readFile(fp, "utf-8");
    const tool = JSON.parse(raw) as CustomToolRecord;
    if (!tool.skillGuide) {
      const skillMd = await readSkillGuide(dataDir, name);
      if (skillMd) tool.skillGuide = skillMd;
    }
    return tool;
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

async function writeCustomTool(dataDir: string, tool: CustomToolRecord): Promise<void> {
  await ensureCustomToolsDir(dataDir);
  await writeFile(toolPath(dataDir, tool.name), JSON.stringify(tool, null, 2) + "\n", "utf-8");
  if (tool.skillGuide) {
    await writeFile(skillPath(dataDir, tool.name), tool.skillGuide, "utf-8");
  }
  if (tool.skillGuide && Array.isArray(tool.skillTags) && tool.skillTags.length > 0) {
    const promptPath = join(toolsDir(dataDir), `${tool.name}.prompt.json`);
    await writeFile(promptPath, JSON.stringify({ tags: tool.skillTags }, null, 2) + "\n", "utf-8");
  }
}

async function deleteCustomTool(dataDir: string, name: string): Promise<void> {
  try {
    await unlink(toolPath(dataDir, name));
  } catch {
    // already gone
  }
  try {
    await unlink(skillPath(dataDir, name));
  } catch {
    // no skill file
  }
  try {
    await unlink(join(toolsDir(dataDir), `${name}.prompt.json`));
  } catch {
    // no prompt.json file
  }
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

        const existing = await readCustomTool(dataDir, name);
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

        await writeCustomTool(dataDir, tool);

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
        const tool = await readCustomTool(dataDir, String(args.name));
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
        const existing = await readCustomTool(dataDir, name);
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
        };

        await writeCustomTool(dataDir, updated);

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
        const existing = await readCustomTool(dataDir, name);
        if (!existing) {
          return { title: "Error", output: `ERROR customTool: tool "${name}" not found`, isError: true };
        }
        await deleteCustomTool(dataDir, name);
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
