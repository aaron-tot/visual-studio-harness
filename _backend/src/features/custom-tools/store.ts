import { readFile, writeFile, readdir, unlink, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CustomTool } from "../../../../_shared/types/custom-tools";
import type { ToolConfig } from "../../../../_shared/types";
import type { ToolDef, ToolResult } from "../tools/types";
import { z } from "zod";
import { listToolFolders, loadToolEntry, folderToToolDef } from "../tools/folder-store";

/**
 * Entry file name inside the unified folder-per-tool shape. Custom tool code
 * is stored as this file (wrapped into an `execute` module), NOT inline in the
 * `<name>.json` ToolConfig.
 */
export const CUSTOM_TOOL_ENTRY = "index.js";

/**
 * Detect an already-module-form entry so writes are idempotent (a UI edit that
 * round-trips a wrapped entry is written back verbatim, never double-wrapped).
 */
const ENTRY_MODULE_RE = /^export\s+(?:async\s+)?function\s+execute\b/s;

/**
 * Convert a `CustomTool.code` (a function BODY, e.g. `return args.msg;` as the
 * legacy store and the UI author) into a loadable folder entry module.
 * `loadToolEntry` dynamic-imports the file and requires an `execute` export.
 */
export function codeToEntryModule(code: string): string {
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
  return join(toolDir(dataDir, name), CUSTOM_TOOL_ENTRY);
}

function skillPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), "skill.md");
}

function promptPath(dataDir: string, name: string): string {
  return join(toolDir(dataDir, name), "prompt.json");
}

export async function ensureCustomToolsDir(dataDir: string): Promise<void> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

/** Read tags from a `prompt.json` file (best effort). */
async function readPromptTags(fp: string): Promise<string[]> {
  try {
    const raw = await readFile(fp, "utf-8");
    const parsed = JSON.parse(raw) as { tags?: unknown };
    return Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Translate a `CustomTool` DTO (the REST/UI wire shape, with `code`) into the
 * `ToolConfig` written to `<name>/<name>.json` in the folder-per-tool shape.
 * The code is NOT stored here — it becomes `index.js`.
 */
export function customToolToConfig(tool: CustomTool): ToolConfig {
  const config: ToolConfig = {
    name: tool.name,
    description: tool.description,
    entry: CUSTOM_TOOL_ENTRY,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    enabled: tool.enabled !== false,
    permissionDefault: tool.permissionDefault ?? "ask",
  };
  if (tool.skillGuide) {
    config.skill = {
      guide: tool.skillGuide,
      pushMode: tool.skillPushMode ?? "soft",
      id: tool.skillId ?? tool.name,
      tags: Array.isArray(tool.skillTags) && tool.skillTags.length > 0 ? tool.skillTags : undefined,
      customPushText: tool.skillCustomPushText,
    };
  }
  return config;
}

/**
 * Translate a folder-per-tool `ToolConfig` + entry content back into the
 * `CustomTool` DTO shape so REST/UI consumers see the same record as before
 * (incl. the `code` field = the entry file content).
 */
export function configToCustomTool(
  config: ToolConfig,
  code: string,
  skillGuide: string | null,
  skillTags: string[]
): CustomTool {
  const tool: CustomTool = {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    code,
    enabled: config.enabled,
    permissionDefault: config.permissionDefault,
  };
  if (skillGuide ?? config.skill?.guide) {
    tool.skillGuide = skillGuide ?? config.skill?.guide;
    tool.skillPushMode = config.skill?.pushMode;
    tool.skillId = config.skill?.id;
    tool.skillCustomPushText = config.skill?.customPushText;
  }
  if (skillTags.length > 0) tool.skillTags = skillTags;
  else if (config.skill?.tags?.length) tool.skillTags = config.skill.tags;
  return tool;
}

export async function listCustomTools(dataDir: string): Promise<CustomTool[]> {
  const dir = toolsDir(dataDir);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const tools: CustomTool[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    const jsonPath = join(dir, name, `${name}.json`);
    if (!existsSync(jsonPath)) continue;
    try {
      const parsed = JSON.parse(await readFile(jsonPath, "utf-8")) as ToolConfig;
      const code = await readFile(join(dir, name, CUSTOM_TOOL_ENTRY), "utf-8").catch(() => "");
      const skillGuide = await readFile(join(dir, name, "skill.md"), "utf-8").catch(() => null);
      const skillTags = await readPromptTags(join(dir, name, "prompt.json"));
      tools.push(configToCustomTool(parsed, code, skillGuide, skillTags));
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
    const config = JSON.parse(raw) as ToolConfig;
    const code = await readFile(entryPath(dataDir, name), "utf-8").catch(() => "");
    const skillGuide = await readSkillGuide(dataDir, name);
    const skillTags = await readPromptTags(promptPath(dataDir, name));
    return configToCustomTool(config, code, skillGuide, skillTags);
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
  await mkdir(toolDir(dataDir, tool.name), { recursive: true });
  await writeFile(toolPath(dataDir, tool.name), JSON.stringify(customToolToConfig(tool), null, 2) + "\n", "utf-8");
  // The tool's code IS the entry file (NOT inline in the config).
  await writeFile(entryPath(dataDir, tool.name), codeToEntryModule(tool.code), "utf-8");

  // Write skill guide markdown file if present; remove a stale one otherwise.
  if (tool.skillGuide) {
    await writeFile(skillPath(dataDir, tool.name), tool.skillGuide, "utf-8");
  } else {
    await unlink(skillPath(dataDir, tool.name)).catch(() => {});
  }

  // Write prompt.json if skill guide exists and tags provided; remove otherwise.
  if (tool.skillGuide && Array.isArray(tool.skillTags) && tool.skillTags.length > 0) {
    await writeFile(promptPath(dataDir, tool.name), JSON.stringify({ tags: tool.skillTags }, null, 2) + "\n", "utf-8");
  } else {
    await unlink(promptPath(dataDir, tool.name)).catch(() => {});
  }
}

export async function deleteCustomTool(dataDir: string, name: string): Promise<void> {
  await rm(toolDir(dataDir, name), { recursive: true, force: true });
}

/**
 * One-time migration from the legacy flat `{dataDir}/custom-tools/` layout
 * (`<name>.json` with inline `code`, `<name>.skill.md`, `<name>.prompt.json`)
 * to the unified folder-per-tool shape `data/tools/custom/<name>/`
 * (`<name>.json` ToolConfig + `index.js` entry + `skill.md`/`prompt.json`).
 *
 * Idempotent: a folder already present in the new shape is skipped, and a
 * second run after success finds no flat `.json` files left to convert.
 * Non-destructive: the legacy flat files are removed only AFTER the folder
 * shape is written AND verified by a read-back.
 *
 * @returns the number of tools migrated.
 */
export async function migrateLegacyCustomTools(dataDir: string): Promise<number> {
  const legacyDir = join(resolve(dataDir), "custom-tools");
  if (!existsSync(legacyDir)) return 0;
  const entries = await readdir(legacyDir, { withFileTypes: true });

  let migrated = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json") || e.name.endsWith(".prompt.json")) continue;
    const legacyName = e.name.slice(0, -".json".length);

    let parsed: CustomTool;
    try {
      parsed = JSON.parse(await readFile(join(legacyDir, e.name), "utf-8")) as CustomTool;
    } catch {
      continue; // unreadable / invalid JSON — leave it for manual handling
    }

    const name = typeof parsed?.name === "string" ? parsed.name : "";
    if (!name || typeof parsed.code !== "string") continue; // not a legacy custom tool
    if (existsSync(toolDir(dataDir, name))) continue; // already migrated (idempotent)

    try {
      // Sibling skill guide / prompt tags are loaded when not inline in the JSON.
      if (!parsed.skillGuide) {
        const skillMd = await readFile(join(legacyDir, `${legacyName}.skill.md`), "utf-8").catch(() => null);
        if (skillMd) parsed.skillGuide = skillMd;
      }
      const siblingTags = await readPromptTags(join(legacyDir, `${legacyName}.prompt.json`));
      if (siblingTags.length > 0) parsed.skillTags = siblingTags;

      await writeCustomTool(dataDir, parsed);

      // Verify the folder shape reads back before touching the legacy source.
      const verify = await readCustomTool(dataDir, name);
      if (!verify || verify.code !== (await readFile(entryPath(dataDir, name), "utf-8"))) {
        await rm(toolDir(dataDir, name), { recursive: true, force: true }).catch(() => {});
        continue;
      }

      migrated++;
      await unlink(join(legacyDir, e.name)).catch(() => {});
      await unlink(join(legacyDir, `${legacyName}.skill.md`)).catch(() => {});
      await unlink(join(legacyDir, `${legacyName}.prompt.json`)).catch(() => {});
    } catch {
      // A failure leaves both the legacy source AND any partial target intact;
      // the source is never deleted on error.
    }
  }
  return migrated;
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
 *
 * NOTE: Inline `code` execution was removed under the unified-tools migration —
 * custom tools run from their folder entry (`data/tools/custom/<name>/index.js`),
 * which is what `loadCustomToolDefs`/`loadToolsFromFolders` load. This builder is
 * kept for description/schema shaping (and legacy callers); the `execute` it
 * returns reports that inline execution is no longer supported.
 */
export function customToolToToolDef(tool: CustomTool): ToolDef {
  return {
    name: tool.name,
    description: buildEffectiveDescription(tool),
    inputSchema: schemaToZod(tool.inputSchema),
    permissionDefault: tool.permissionDefault ?? "ask",
    execute: async (): Promise<ToolResult> => ({
      title: tool.name,
      output: `Custom tool "${tool.name}" is loaded from its folder entry (data/tools/custom/${tool.name}/${CUSTOM_TOOL_ENTRY}); inline 'code' execution was removed in the unified-tools migration.`,
      isError: true,
    }),
  };
}

/**
 * Load all enabled custom tools as ToolDef instances.
 *
 * Delegates to the folder store so custom tools in the unified
 * `data/tools/custom/` shape are loaded exactly like builtins (entry files
 * dynamic-imported, ctx resolved by the harness). run-turn uses
 * `createFolderRegistry` directly, which already includes custom tools.
 */
export async function loadCustomToolDefs(dataDir: string): Promise<ToolDef[]> {
  const folders = (await listToolFolders(dataDir)).filter((f) => f.kind === "custom");
  const defs: ToolDef[] = [];
  for (const folder of folders) {
    if (!folder.config.enabled) continue;
    try {
      const entry = await loadToolEntry(folder);
      defs.push(folderToToolDef(folder, entry.execute));
    } catch (err) {
      console.error(
        `[custom-tools] skipping tool '${folder.name}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return defs;
}
