import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import {
  listCustomTools,
  readCustomTool,
  writeCustomTool,
  deleteCustomTool,
  ensureCustomToolsDir,
} from "../../../features/custom-tools/store";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const ACTIONS = ["create", "read", "update", "delete", "list"] as const;
type Action = (typeof ACTIONS)[number];

const customToolSchema = z.object({
  action: z.enum(ACTIONS).describe("Operation to perform: create, read, update, delete, list"),
  name: z.string().optional().describe("Tool name (required for create, read, update, delete)"),
  description: z.string().optional().describe("Tool description (for create/update)"),
  inputSchema: z
    .record(z.unknown())
    .optional()
    .describe("JSON Schema for tool parameters (for create/update)"),
  code: z.string().optional().describe("JavaScript handler code (for create/update)"),
  enabled: z.boolean().optional().describe("Whether tool is enabled (for create/update)"),
  permissionDefault: z
    .enum(["allow", "ask", "deny"])
    .optional()
    .describe("Default permission mode (for create/update)"),
  skillGuide: z.string().optional().describe("Skill guide markdown content (for create/update)"),
  skillPushMode: z
    .enum(["soft", "hard", "custom"])
    .optional()
    .describe("Skill push mode: soft, hard, or custom (for create/update)"),
  skillId: z.string().optional().describe("Skill ID for reading via skill tool (for create/update)"),
  skillCustomPushText: z.string().optional().describe("Custom push text when skillPushMode is custom (for create/update)"),
  skillTags: z.array(z.string()).optional().describe("Tags for skill guide (stored in prompt.json)"),
});

export const customToolTool: ToolDef = {
  name: "customTool",
  description:
    "Manage custom tools. Set 'action' to create, read, update, delete, or list. " +
    "Custom tools are user-defined tools stored in data/tools/custom/<name>/ (folder-per-tool: " +
    "<name>.json ToolConfig + index.js entry, with optional skill.md/prompt.json). " +
    "They support skill guides with soft/hard/custom push modes.",
  permissionDefault: "allow",
  outputFields: [
    { name: "action", type: "string", description: "Action that was performed", required: true },
    { name: "name", type: "string", description: "Tool name", required: false },
    { name: "tools", type: "array", description: "List of tools (list action)", required: false },
    { name: "tool", type: "object", description: "Tool definition (read/create/update)", required: false },
  ],
  inputSchema: customToolSchema,
  execute: async (args, ctx): Promise<ToolResult> => {
    const action = args.action;
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
          if (!args.name) return { title: "Error", output: "ERROR customTool: name is required for create", isError: true };
          if (!SAFE_NAME.test(args.name)) {
            return { title: "Error", output: "ERROR customTool: invalid name (alphanumeric, hyphens, underscores; 1-64 chars)", isError: true };
          }
          if (!args.code?.trim()) return { title: "Error", output: "ERROR customTool: code is required for create", isError: true };
          if (!args.description?.trim()) return { title: "Error", output: "ERROR customTool: description is required for create", isError: true };

          const existing = await readCustomTool(ctx.dataDir!, args.name);
          if (existing) {
            return { title: "Error", output: `ERROR customTool: tool "${args.name}" already exists`, isError: true };
          }

          // Validate inputSchema
          let inputSchema: Record<string, unknown>;
          try {
            inputSchema = args.inputSchema ?? { type: "object", properties: {} };
          } catch {
            return { title: "Error", output: "ERROR customTool: invalid inputSchema", isError: true };
          }

          const tool = {
            name: args.name,
            description: args.description?.trim() ?? "",
            inputSchema,
            code: args.code.trim(),
            enabled: args.enabled !== false,
            permissionDefault: args.permissionDefault ?? "ask",
            skillGuide: args.skillGuide?.trim() ?? undefined,
            skillPushMode: args.skillPushMode ?? undefined,
            skillId: args.skillId?.trim() ?? undefined,
            skillCustomPushText: args.skillCustomPushText?.trim() ?? undefined,
            skillTags: args.skillTags ?? undefined,
          };

          await writeCustomTool(ctx.dataDir!, tool);

          return {
            title: `Created: ${args.name}`,
            output: `Custom tool "${args.name}" created successfully.`,
            metadata: { action: "create", tool },
          };
        }

        case "read": {
          if (!args.name) return { title: "Error", output: "ERROR customTool: name is required for read", isError: true };
          const tool = await readCustomTool(ctx.dataDir!, args.name);
          if (!tool) {
            return { title: "Error", output: `ERROR customTool: tool "${args.name}" not found`, isError: true };
          }
          return {
            title: `Tool: ${args.name}`,
            output: JSON.stringify(tool, null, 2),
            metadata: { action: "read", tool },
          };
        }

        case "update": {
          if (!args.name) return { title: "Error", output: "ERROR customTool: name is required for update", isError: true };
          const existing = await readCustomTool(ctx.dataDir!, args.name);
          if (!existing) {
            return { title: "Error", output: `ERROR customTool: tool "${args.name}" not found`, isError: true };
          }

          let inputSchema: Record<string, unknown> | undefined;
          if (args.inputSchema !== undefined) {
            try {
              inputSchema = args.inputSchema;
            } catch {
              return { title: "Error", output: "ERROR customTool: invalid inputSchema", isError: true };
            }
          }

          const updated = {
            ...existing,
            description: args.description?.trim() ?? existing.description,
            inputSchema: args.inputSchema ?? existing.inputSchema,
            code: args.code?.trim() ?? existing.code,
            enabled: args.enabled ?? existing.enabled,
            permissionDefault: args.permissionDefault ?? existing.permissionDefault,
            skillGuide: args.skillGuide !== undefined ? (args.skillGuide?.trim() ?? undefined) : existing.skillGuide,
            skillPushMode: args.skillPushMode ?? existing.skillPushMode,
            skillId: args.skillId !== undefined ? (args.skillId?.trim() ?? undefined) : existing.skillId,
            skillCustomPushText: args.skillCustomPushText !== undefined ? (args.skillCustomPushText?.trim() ?? undefined) : existing.skillCustomPushText,
          };

          await writeCustomTool(ctx.dataDir!, updated);

          return {
            title: `Updated: ${args.name}`,
            output: `Custom tool "${args.name}" updated successfully.`,
            metadata: { action: "update", tool: updated },
          };
        }

        case "delete": {
          if (!args.name) return { title: "Error", output: "ERROR customTool: name is required for delete", isError: true };
          const existing = await readCustomTool(ctx.dataDir!, args.name);
          if (!existing) {
            return { title: "Error", output: `ERROR customTool: tool "${args.name}" not found`, isError: true };
          }
          await deleteCustomTool(ctx.dataDir!, args.name);
          return {
            title: `Deleted: ${args.name}`,
            output: `Custom tool "${args.name}" deleted successfully.`,
            metadata: { action: "delete", name: args.name },
          };
        }

        default:
          return { title: "Error", output: `ERROR customTool: unknown action "${String(action)}"`, isError: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { title: "Error", output: `ERROR customTool: ${msg}`, isError: true };
    }
  },
};
