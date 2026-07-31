import { z } from "zod";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ToolDef, ToolFieldDef } from "../types";
import { resolveDesignsDir } from "../../../rest/plans";
import type { DesignsScope } from "../../../rest/plans";

/**
 * Deep-merge `patch` into `target` per RFC 7396 (JSON Merge Patch).
 *
 * - Plain objects: recurse
 * - Arrays & primitives: replace
 * - `null` in patch: delete key from target
 */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Copy all existing keys
  for (const key of Object.keys(target)) {
    out[key] = target[key];
  }
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === null) {
      // RFC 7396: null removes the key
      delete out[key];
    } else if (
      typeof pv === "object" &&
      !Array.isArray(pv) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      // Both sides are plain objects → recurse
      out[key] = deepMerge(
        out[key] as Record<string, unknown>,
        pv as Record<string, unknown>,
      );
    } else {
      // Arrays, primitives, or type mismatch → replace
      out[key] = pv;
    }
  }
  return out;
}

export const designEditTool: ToolDef = {
  name: "design_edit",
  description:
    "Edit a spec or plan document. Two modes: (1) provide `document` for a full replacement, or (2) provide `patch` for a surgical merge (RFC 7396 JSON Merge Patch). " +
    "In patch mode, nested objects are deep-merged; arrays and primitives are fully replaced. " +
    "The tool automatically updates meta.updatedAt and meta.updatedBy in either mode.",
  permissionDefault: "allow",
  outputFields: [
    { name: "updated", type: "boolean", description: "Whether the update succeeded", required: true },
    { name: "name", type: "string", description: "Design directory name", required: true },
    { name: "type", type: "enum(spec | plan)", description: "Document type that was edited", required: true },
    { name: "version", type: "integer", description: "Version that was edited", required: true },
    { name: "path", type: "string", description: "Full filesystem path to the document", required: true },
  ],
  inputSchema: z
    .object({
      name: z.string().min(1).describe("Design directory name"),
      type: z.enum(["spec", "plan"]).describe("Document type"),
      version: z
        .number()
        .int()
        .positive()
        .describe("Version number to edit"),
      document: z
        .record(z.unknown())
        .optional()
        .describe(
          "Full replacement document JSON. Mutually exclusive with `patch`.",
        ),
      patch: z
        .record(z.unknown())
        .optional()
        .describe(
          "Partial document to merge into the existing document (RFC 7396). " +
            "Nested objects deep-merge; arrays and primitives are fully replaced. " +
            "Mutually exclusive with `document`.",
        ),
    })
    .refine((d) => !(d.document && d.patch), {
      message: "Provide either `document` (full replace) or `patch` (merge), not both",
    })
    .refine((d) => d.document || d.patch, {
      message: "Provide either `document` (full replace) or `patch` (merge)",
    }),
  execute: async (args, ctx) => {
    const designsDir = resolveDesignsDir(
      ctx.dataDir,
      "global" as DesignsScope,
      ctx.workspaceRoot,
      ctx.sessionId,
    );
    if (!designsDir) {
      return {
        title: "Error",
        output: "Could not resolve designs directory",
        metadata: { updated: false },
        isError: true,
      };
    }
    const fp = join(designsDir, args.name, `${args.type}V${args.version}.json`);
    if (!existsSync(fp)) {
      return {
        title: "Not found",
        output: `${args.type} v${args.version} not found in "${args.name}"`,
        metadata: { updated: false },
      };
    }

    let doc: Record<string, unknown>;

    if (args.patch) {
      // ---- PATCH MODE: read current, deep-merge patch into it ----
      const raw = await readFile(fp, "utf-8");
      const current = JSON.parse(raw) as Record<string, unknown>;
      doc = deepMerge(current, args.patch);
    } else {
      // ---- FULL REPLACE MODE: use document as-is (backward compat) ----
      doc = args.document!;
    }

    // Auto-set meta timestamps in either mode
    if (doc.meta && typeof doc.meta === "object") {
      const meta = doc.meta as Record<string, unknown>;
      meta.updatedAt = new Date().toISOString();
      meta.updatedBy = "agent";
    }

    await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");

    return {
      title: "Design updated",
      output: `Updated ${args.name} ${args.type} v${args.version}${args.patch ? " (patch mode)" : ""}`,
      metadata: {
        updated: true,
        name: args.name,
        type: args.type,
        version: args.version,
        path: fp,
      },
    };
  },
};
