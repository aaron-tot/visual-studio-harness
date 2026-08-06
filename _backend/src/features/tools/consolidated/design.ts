import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import { designCreateTool } from "../builtins/design_create";
import { designReadTool } from "../builtins/design_read";
import { designEditTool } from "../builtins/design_edit";
import { designAbandonTool } from "../builtins/design_abandon";

/**
 * Consolidated `design` tool.
 *
 * Replaces the 4 individual design_* tools with a single registered tool that
 * dispatches on a required `action` enum. Every sub-command forwards to the
 * original tool implementation, so behavior is identical to before.
 *
 * Sub-commands (via `action`):
 *   create  - Create a new spec or plan document   (design_create)
 *   read    - Read a spec or plan document          (design_read)
 *   edit    - Edit a spec/plan (replace or patch)   (design_edit)
 *   abandon - Mark a design as abandoned            (design_abandon)
 *
 * Schema is a flat object: `action` is the only required field; all other
 * params are optional and shared across the sub-commands, each defined once.
 */
const DESIGN_ACTIONS = ["create", "read", "edit", "abandon"] as const;

export type DesignAction = (typeof DESIGN_ACTIONS)[number];

const ORIGINAL_TOOLS: Record<DesignAction, ToolDef> = {
  create: designCreateTool,
  read: designReadTool,
  edit: designEditTool,
  abandon: designAbandonTool,
};

const designSchema = z.object({
  action: z.enum(DESIGN_ACTIONS).describe("Operation: create, read, edit, abandon"),
  name: z.string().optional().describe("Design directory name"),
  type: z.enum(["spec", "plan"]).optional().describe("Document type"),
  version: z.number().int().positive().optional().describe("Version"),
  goal: z.string().optional().describe("Goal or end-goal"),
  specReference: z.string().optional().describe("Spec name this plan implements"),
  scope: z.enum(["global", "project", "session"]).optional().describe("Scope"),
  content: z
    .union([
      z.record(z.unknown()),
      z.string().transform((s, ctx) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(s);
        } catch {
          ctx.addIssue({ code: "custom", message: "content must be valid JSON" });
          return z.NEVER;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          ctx.addIssue({ code: "custom", message: "content must be a JSON object" });
          return z.NEVER;
        }
        return parsed as Record<string, unknown>;
      }),
    ])
    .optional()
    .describe("Document body (JSON object or valid JSON object string); see skill:design"),
  document: z
    .union([
      z.record(z.unknown()),
      z.string().transform((s, ctx) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(s);
        } catch {
          ctx.addIssue({ code: "custom", message: "document must be valid JSON" });
          return z.NEVER;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          ctx.addIssue({ code: "custom", message: "document must be a JSON object" });
          return z.NEVER;
        }
        return parsed as Record<string, unknown>;
      }),
    ])
    .optional()
    .describe("Full replacement document JSON (object or valid JSON object string)"),
  patch: z
    .union([
      z.record(z.unknown()),
      z.string().transform((s, ctx) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(s);
        } catch {
          ctx.addIssue({ code: "custom", message: "patch must be valid JSON" });
          return z.NEVER;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          ctx.addIssue({ code: "custom", message: "patch must be a JSON object" });
          return z.NEVER;
        }
        return parsed as Record<string, unknown>;
      }),
    ])
    .optional()
    .describe("Partial doc to merge (RFC 7396) (object or valid JSON object string)"),
  reason: z.string().optional().describe("Abandon reason"),
  successor: z.string().optional().describe("Replacement design name"),
});

export const designTool: ToolDef = {
  name: "design",
  description:
    "Create, read, edit, and abandon spec/plan design documents. Set 'action' to pick the operation. " +
    "Parameters content, document, and patch accept JSON objects or valid JSON object strings. " +
    "See skill:design for the document structure and skill:design-edit for patch semantics.",
  permissionDefault: "allow",
  inputSchema: designSchema,
  execute: async (args, ctx) => {
    const action = args.action as DesignAction;
    const tool = ORIGINAL_TOOLS[action];
    if (!tool) {
      const result: ToolResult = {
        title: "Invalid action",
        output: `Unknown design action: "${String(args.action)}".`,
        isError: true,
      };
      return result;
    }
    return tool.execute(args as never, ctx);
  },
};

export const designActions = DESIGN_ACTIONS;
