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
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
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
    return JSON.parse(raw) as CustomTool;
  } catch {
    return null;
  }
}

export async function writeCustomTool(dataDir: string, tool: CustomTool): Promise<void> {
  await ensureCustomToolsDir(dataDir);
  await writeFile(toolPath(dataDir, tool.name), JSON.stringify(tool, null, 2) + "\n", "utf-8");
}

export async function deleteCustomTool(dataDir: string, name: string): Promise<void> {
  try {
    await unlink(toolPath(dataDir, name));
  } catch {
    // already gone
  }
}

/**
 * Convert a CustomTool JSON Schema to a Zod schema for use as a ToolDef.inputSchema.
 */
function schemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
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
    description: tool.description,
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
