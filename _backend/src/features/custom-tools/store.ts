import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CustomTool } from "../../../../_shared/types/custom-tools";
import type { ToolDef, ToolResult } from "../tools/types";
import { z } from "zod";

function toolsDir(dataDir: string): string {
  return join(resolve(dataDir), "custom-tools");
}

function toolPath(dataDir: string, name: string): string {
  return join(toolsDir(dataDir), `${name}.json`);
}

function skillPath(dataDir: string, name: string): string {
  return join(toolsDir(dataDir), `${name}.skill.md`);
}

export async function ensureCustomToolsDir(dataDir: string): Promise<void> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function listCustomTools(dataDir: string): Promise<CustomTool[]> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tools: CustomTool[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name.endsWith(".prompt.json")) continue;
    try {
      const raw = await readFile(join(dir, e.name), "utf-8");
      const parsed = JSON.parse(raw) as CustomTool;
      tools.push(parsed);
    } catch {
      // skip unreadable
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readCustomTool(dataDir: string, name: string): Promise<CustomTool | null> {
  const fp = toolPath(dataDir, name);
  try {
    const raw = await readFile(fp, "utf-8");
    const tool = JSON.parse(raw) as CustomTool;
    // Load skill guide from .skill.md file if exists and not already in JSON
    if (!tool.skillGuide) {
      const skillMd = await readSkillGuide(dataDir, name);
      if (skillMd) tool.skillGuide = skillMd;
    }
    return tool;
  } catch {
    return null;
  }
}

export async function readSkillGuide(dataDir: string, name: string): Promise<string | null> {
  const fp = skillPath(dataDir, name);
  try {
    return await readFile(fp, "utf-8");
  } catch {
    return null;
  }
}

export async function writeCustomTool(dataDir: string, tool: CustomTool): Promise<void> {
  await ensureCustomToolsDir(dataDir);
  await writeFile(toolPath(dataDir, tool.name), JSON.stringify(tool, null, 2) + "\n", "utf-8");

  // Write skill guide markdown file if present
  if (tool.skillGuide) {
    await writeFile(skillPath(dataDir, tool.name), tool.skillGuide, "utf-8");
  }

  // Write prompt.json if skill guide exists and tags provided
  if (tool.skillGuide && tool.skillTags && tool.skillTags.length > 0) {
    const promptPath = join(toolsDir(dataDir), `${tool.name}.prompt.json`);
    await writeFile(promptPath, JSON.stringify({ tags: tool.skillTags }, null, 2) + "\n", "utf-8");
  }
}

export async function deleteCustomTool(dataDir: string, name: string): Promise<void> {
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
    const promptPath = join(toolsDir(dataDir), `${name}.prompt.json`);
    await unlink(promptPath);
  } catch {
    // no prompt.json file
  }
}

/**
 * Build the effective description with skill guide injection.
 */
function buildEffectiveDescription(tool: CustomTool): string {
  let desc = tool.description;
  if (tool.skillGuide) {
    const skillId = tool.skillId ?? tool.name;
    let pushText: string;
    if (tool.skillPushMode === "hard") {
      pushText = `MUST read the skill guide (skill ID: ${skillId}) before using this tool. Use the skill tool to read it.`;
    } else if (tool.skillPushMode === "custom") {
      pushText = tool.skillCustomPushText ?? `A skill guide exists for this tool (skill ID: ${skillId}). You may read it with the skill tool if needed.`;
    } else {
      pushText = `A skill guide exists for this tool (skill ID: ${skillId}). You may read it with the skill tool if needed.`;
    }
    desc = `${desc}\n\n${pushText}`;
  }
  return desc;
}

/**
 * Convert a JSON Schema to a Zod schema for use as a ToolDef.inputSchema.
 */
export function schemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (schema?.type === "object" && schema?.properties && typeof schema.properties === "object") {
    const required = Array.isArray(schema.required) ? schema.required as string[] : [];
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
      const p = prop as Record<string, unknown>;
      const desc = typeof p.description === "string" ? p.description : undefined;
      let zodType: z.ZodTypeAny;
      switch (p.type) {
        case "string": zodType = z.string(); break;
        case "number": zodType = z.number(); break;
        case "boolean": zodType = z.boolean(); break;
        case "array": zodType = z.array(z.any()); break;
        default: zodType = z.any();
      }
      if (desc) zodType = zodType.describe(desc);
      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }
    return z.object(shape);
  }
  return z.object({});
}

/**
 * Build a ToolDef from a CustomTool config so it can be registered in the tool registry.
 */
export function customToolToToolDef(tool: CustomTool): ToolDef {
  const execute = async (args: unknown): Promise<ToolResult> => {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("args", "ctx", tool.code);
      const result = await fn(args, {});
      if (typeof result === "string") return { title: tool.name, output: result };
      if (result && typeof result === "object") {
        return { title: tool.name, output: result.output ?? "", isError: result.isError ?? false };
      }
      return { title: tool.name, output: String(result ?? "") };
    } catch (err) {
      return {
        title: tool.name,
        output: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  };

  return {
    name: tool.name,
    description: buildEffectiveDescription(tool),
    inputSchema: schemaToZod(tool.inputSchema),
    permissionDefault: tool.permissionDefault ?? "ask",
    execute,
  };
}

/**
 * Load all enabled custom tools as ToolDef instances.
 */
export async function loadCustomToolDefs(dataDir: string): Promise<ToolDef[]> {
  const tools = await listCustomTools(dataDir);
  return tools.filter((t) => t.enabled).map(customToolToToolDef);
}
