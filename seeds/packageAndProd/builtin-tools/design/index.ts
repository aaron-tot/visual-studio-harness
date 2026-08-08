/**
 * Builtin `design` tool — self-contained ctx entry.
 * Consolidated dispatcher: create / read / edit / abandon / list.
 * Ported from builtins/design_{create,read,edit,abandon}.ts + designs_list.ts.
 * Uses ctx.services (createSpecDocument/createPlanDocument/listDesigns/
 * resolveDesignsDir) and node:fs for versioned document read/edit.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";

const SPEC_RE = /^specV(\d+)\.json$/;
const PLAN_RE = /^planV(\d+)\.json$/;

type Scope = "global" | "project" | "session";

/** Coerce content/document/patch args (JSON object or valid JSON object string) to a record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** Prefer explicit scope; otherwise search session → project → global. */
async function resolveDesignDir(
  name: string,
  scope: Scope | undefined,
  ctx: any
): Promise<{ dir: string; scope: Scope } | null> {
  const tryScopes: Scope[] = [];
  if (scope) tryScopes.push(scope);
  else {
    if (ctx.sessionId) tryScopes.push("session");
    if (ctx.workspaceRoot) tryScopes.push("project");
    tryScopes.push("global");
  }
  for (const sc of tryScopes) {
    const base = ctx.services.resolveDesignsDir(sc, ctx.workspaceRoot, ctx.sessionId);
    if (!base) continue;
    const pd = join(base, name);
    if (existsSync(pd)) return { dir: pd, scope: sc };
  }
  return null;
}

/**
 * Deep-merge `patch` into `target` per RFC 7396 (JSON Merge Patch).
 * - Plain objects: recurse; Arrays & primitives: replace; null: delete key.
 */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (pv === null) {
      delete out[key];
    } else if (
      typeof pv === "object" &&
      !Array.isArray(pv) &&
      typeof out[key] === "object" &&
      out[key] !== null &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, pv as Record<string, unknown>);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

async function latestVersion(dir: string, type: "spec" | "plan"): Promise<number | null> {
  const pattern = type === "spec" ? SPEC_RE : PLAN_RE;
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  let max = 0;
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max > 0 ? max : null;
}

async function actionCreate(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const content = asRecord(args.content);
  if (args.type === "spec") {
    const result = await ctx.services.createSpecDocument({
      name: args.name,
      goal: String(args.goal ?? ""),
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
      createdBy: "agent",
      scope,
      content,
    });
    return {
      title: "Spec created",
      output: `Created spec v${result.version} for design "${args.name}" at ${result.path}`,
      metadata: {
        action: "created",
        type: "spec",
        name: args.name,
        version: result.version,
        path: result.path,
      },
    };
  }
  const result = await ctx.services.createPlanDocument({
    name: args.name,
    endGoal: String(args.goal ?? ""),
    workspaceRoot: ctx.workspaceRoot,
    sessionId: ctx.sessionId,
    createdBy: "agent",
    specReference: args.specReference,
    scope,
    content,
  });
  return {
    title: "Plan created",
    output: `Created plan v${result.version} for design "${args.name}" at ${result.path}`,
    metadata: {
      action: "created",
      type: "plan",
      name: args.name,
      version: result.version,
      path: result.path,
    },
  };
}

async function actionRead(args: any, ctx: any) {
  const pattern = args.type === "spec" ? SPEC_RE : PLAN_RE;
  const found = await resolveDesignDir(args.name, args.scope as Scope | undefined, ctx);
  if (!found) {
    return {
      title: "Not found",
      output: `Design "${args.name}" not found${
        args.scope ? ` in "${args.scope}" scope` : " in session/project/global scopes"
      }`,
      metadata: { found: false },
    };
  }
  const pd = found.dir;
  const entries = await readdir(pd);
  const matched: { version: number; file: string }[] = [];
  for (const f of entries) {
    const m = f.match(pattern);
    if (m) matched.push({ version: parseInt(m[1], 10), file: f });
  }
  if (matched.length === 0) {
    return {
      title: "No documents",
      output: `No ${args.type} documents in "${args.name}"`,
      metadata: { found: false },
    };
  }
  matched.sort((a, b) => a.version - b.version);
  const target =
    args.version != null ? matched.find((m) => m.version === args.version) : matched[matched.length - 1];
  if (!target) {
    const available = matched.map((m) => m.version).join(", ");
    return {
      title: "Not found",
      output:
        args.version == null
          ? `No ${args.type} versions in "${args.name}"`
          : `${args.type} v${args.version} not found in "${args.name}". Available: ${available || "none"}. Omit version to read latest.`,
      metadata: { found: false, allVersions: matched.map((m) => m.version) },
    };
  }
  const raw = await readFile(join(pd, target.file), "utf-8");
  return {
    title: `${args.name} ${args.type} v${target.version}`,
    output: raw,
    metadata: {
      found: true,
      path: join(pd, target.file),
      name: args.name,
      type: args.type,
      version: target.version,
      allVersions: matched.map((m) => m.version),
      scope: found.scope,
    },
  };
}

async function actionEdit(args: any, ctx: any) {
  const found = await resolveDesignDir(args.name, args.scope as Scope | undefined, ctx);
  if (!found) {
    return {
      title: "Not found",
      output: `Design "${args.name}" not found${
        args.scope ? ` in "${args.scope}" scope` : " in session/project/global scopes"
      }`,
      metadata: { updated: false },
      isError: true,
    };
  }

  let version = args.version as number | undefined;
  if (version == null) {
    const latest = await latestVersion(found.dir, args.type);
    if (latest == null) {
      return {
        title: "Not found",
        output: `No ${args.type} versions in "${args.name}". Pass version explicitly after creating one.`,
        metadata: { updated: false },
        isError: true,
      };
    }
    version = latest;
  }

  const fp = join(found.dir, `${args.type}V${version}.json`);
  if (!existsSync(fp)) {
    const latest = await latestVersion(found.dir, args.type);
    return {
      title: "Not found",
      output:
        `${args.type} v${version} not found in "${args.name}".` +
        (latest != null
          ? ` Latest available: v${latest}. Omit version to edit latest.`
          : " No versions exist."),
      metadata: { updated: false },
      isError: true,
    };
  }

  const patch = asRecord(args.patch);
  const document = asRecord(args.document);
  if (patch && document) {
    return {
      title: "Error",
      output: "Provide either `document` (full replace) or `patch` (merge), not both",
      metadata: { updated: false },
      isError: true,
    };
  }
  if (!patch && !document) {
    return {
      title: "Error",
      output: "Provide either `document` (full replace) or `patch` (merge)",
      metadata: { updated: false },
      isError: true,
    };
  }
  let doc: Record<string, unknown>;
  if (patch) {
    const raw = await readFile(fp, "utf-8");
    const current = JSON.parse(raw) as Record<string, unknown>;
    doc = deepMerge(current, patch);
  } else {
    doc = document ?? {};
  }

  if (doc.meta && typeof doc.meta === "object") {
    const meta = doc.meta as Record<string, unknown>;
    meta.updatedAt = new Date().toISOString();
    meta.updatedBy = "agent";
    if (meta.version == null) meta.version = version;
  }

  await writeFile(fp, JSON.stringify(doc, null, 2) + "\n");

  return {
    title: "Design updated",
    output: `Updated ${args.name} ${args.type} v${version} (${found.scope})${patch ? " (patch mode)" : ""}`,
    metadata: {
      updated: true,
      name: args.name,
      type: args.type,
      version,
      path: fp,
      scope: found.scope,
    },
  };
}

async function actionAbandon(args: any, ctx: any) {
  const found = await resolveDesignDir(args.name, args.scope as Scope | undefined, ctx);
  if (!found) {
    return {
      title: "Not found",
      output: `Design "${args.name}" not found`,
      metadata: { abandoned: false },
    };
  }
  const metaPath = join(found.dir, "meta.json");
  let meta: Record<string, unknown> = {};
  try {
    const raw = await readFile(metaPath, "utf-8");
    meta = JSON.parse(raw);
  } catch {
    /* no meta yet */
  }
  meta.abandoned = {
    reason: args.reason,
    successor: args.successor || undefined,
    timestamp: new Date().toISOString(),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n");
  return {
    title: "Design abandoned",
    output: `"${args.name}" abandoned. Reason: ${args.reason}`,
    metadata: { abandoned: true, name: args.name, reason: args.reason, successor: args.successor || null },
  };
}

async function actionList(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const entries = await ctx.services.listDesigns(scope, ctx.workspaceRoot, ctx.sessionId);
  if (entries.length === 0) {
    return {
      title: "No designs",
      output: `No designs found in "${scope}" scope. Use design_create to create one.`,
      metadata: { count: 0, scope },
    };
  }
  const ver = (doc: any) => doc?.meta?.version;
  const lines = entries.map((e: any) => {
    const sv = e.specs.map((s: any) => `v${ver(s) ?? "?"}`).join(", ") || "none";
    const pv = e.plans.map((p: any) => `v${ver(p) ?? "?"}`).join(", ") || "none";
    return `  ${e.name}/  (specs: ${sv}, plans: ${pv})`;
  });
  return {
    title: `${entries.length} design(s) in ${scope} scope`,
    output: lines.join("\n"),
    metadata: {
      count: entries.length,
      scope,
      designs: entries.map((e: any) => ({
        name: e.name,
        path: e.path,
        specVersions: e.specs.map((s: any) => ver(s)).filter((v: any): v is number => v != null),
        planVersions: e.plans.map((p: any) => ver(p)).filter((v: any): v is number => v != null),
      })),
    },
  };
}

export async function execute(args: any, ctx: any): Promise<any> {
  const action = args.action;
  switch (action) {
    case "create":
      return actionCreate(args, ctx);
    case "read":
      return actionRead(args, ctx);
    case "edit":
      return actionEdit(args, ctx);
    case "abandon":
      return actionAbandon(args, ctx);
    case "list":
      return actionList(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown design action: "${String(action)}".`,
    isError: true,
  };
}
