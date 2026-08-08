/**
 * Builtin `audit` tool — self-contained ctx entry.
 * Consolidated dispatcher: create / read / edit / delete / prompt_* / list.
 * Ported from builtins/audit_{create,read,edit,delete,list}.ts +
 * audit_prompt_{create,list,read,edit,delete}.ts.
 * Uses ctx.services (audits + audit-prompts) and node:fs for the read/delete paths.
 */
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

type Scope = "global" | "project" | "session";

async function actionCreate(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const findings: any[] = Array.isArray(args.findings) ? args.findings : [];

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = f?.severity as keyof typeof severityCounts | undefined;
    if (sev !== undefined && sev in severityCounts) severityCounts[sev]++;
  }

  const document = {
    meta: {
      id: args.name,
      title: args.title,
      auditType: args.auditType,
      endGoal: args.endGoal,
      createdAt: ctx.localISOString(),
      createdBy: "agent",
      agentModel:
        args.agentModel ||
        [ctx.providerName, ctx.modelName].filter(Boolean).join(" / ") ||
        undefined,
      scope,
      workspaceRoot: ctx.workspaceRoot || undefined,
      sessionId: ctx.sessionId || undefined,
      summary: args.summary,
      totalFindings: findings.length,
      criticalCount: severityCounts.critical,
      highCount: severityCounts.high,
      mediumCount: severityCounts.medium,
      lowCount: severityCounts.low,
      infoCount: severityCounts.info,
      attachments: Array.isArray(args.attachments) && args.attachments.length ? args.attachments : undefined,
      overallStatus: args.overallStatus,
      overallAssessment: args.overallAssessment,
      assessments: Array.isArray(args.assessments) && args.assessments.length ? args.assessments : undefined,
    },
    findings,
    rawReport: args.rawReport,
  };

  try {
    const result = await ctx.services.createAudit({
      name: args.name,
      document,
      scope,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    return {
      title: "Audit created",
      output: `Created audit "${args.title}" as "${args.name}" in ${scope} scope. ${findings.length} findings (${severityCounts.critical} critical, ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low, ${severityCounts.info} info).`,
      metadata: { created: true, name: args.name, path: result.path },
    };
  } catch (err) {
    return {
      title: "Failed to create audit",
      output: `Error creating audit "${args.name}": ${(err as Error).message}`,
      metadata: { created: false },
      isError: true,
    };
  }
}

async function actionRead(args: any, ctx: any) {
  let scope = args.scope as Scope | undefined;
  if (!scope) {
    scope = (await ctx.services.findAuditScope(args.name, ctx.workspaceRoot, ctx.sessionId)) ?? undefined;
    if (!scope) {
      return {
        title: "Not found",
        output: `Audit "${args.name}" not found in session/project/global scopes.`,
        metadata: { found: false },
      };
    }
  }
  const auditsDir = ctx.services.resolveAuditsDir(scope, ctx.workspaceRoot, ctx.sessionId);
  if (!auditsDir) {
    return {
      title: "Error",
      output: `Cannot resolve audits directory for scope "${scope}".`,
      metadata: { found: false },
      isError: true,
    };
  }
  const fp = join(auditsDir, args.name, "audit.json");
  if (!existsSync(fp)) {
    return {
      title: "Not found",
      output: `Audit "${args.name}" not found in "${scope}" scope.`,
      metadata: { found: false },
    };
  }
  const raw = await readFile(fp, "utf-8");
  const data = JSON.parse(raw);
  const m = data.meta || {};
  return {
    title: m.title || args.name,
    output: raw,
    metadata: {
      found: true,
      name: args.name,
      title: m.title || args.name,
      auditType: m.auditType,
      totalFindings: m.totalFindings,
      criticalCount: m.criticalCount,
      highCount: m.highCount,
      mediumCount: m.mediumCount,
      lowCount: m.lowCount,
      infoCount: m.infoCount,
      summary: m.summary,
      overallStatus: m.overallStatus,
      scope,
    },
  };
}

async function actionEdit(args: any, ctx: any) {
  const scope = args.scope as Scope | undefined;
  try {
    const result = await ctx.services.editAudit({
      name: args.name,
      document: args.document,
      scope,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    return {
      title: "Audit updated",
      output: `Updated audit "${args.name}" in ${result.scope} scope.`,
      metadata: { updated: true, name: args.name, path: result.path, scope: result.scope },
    };
  } catch (err) {
    return {
      title: "Failed to update audit",
      output: `Error updating audit "${args.name}": ${(err as Error).message}`,
      metadata: { updated: false, name: args.name, path: "" },
      isError: true,
    };
  }
}

async function actionDelete(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const auditsDir = ctx.services.resolveAuditsDir(scope, ctx.workspaceRoot, ctx.sessionId);
  if (!auditsDir) {
    return {
      title: "Error",
      output: `Cannot resolve audits directory for scope "${scope}".`,
      metadata: { deleted: false },
      isError: true,
    };
  }
  const nd = join(auditsDir, args.name);
  if (!existsSync(nd)) {
    return {
      title: "Not found",
      output: `Audit "${args.name}" not found in "${scope}" scope.`,
      metadata: { deleted: false },
    };
  }
  await rm(nd, { recursive: true, force: true });
  return {
    title: "Audit deleted",
    output: `Deleted audit "${args.name}" from "${scope}" scope.`,
    metadata: { deleted: true, name: args.name },
  };
}

async function actionPromptCreate(args: any, ctx: any) {
  try {
    const result = await ctx.services.createPrompt({
      id: args.id,
      name: args.name,
      description: args.description || "",
      category: (args.category || "general") as "general" | "implementation",
      auditType: args.auditType || "custom",
      endGoal: args.endGoal,
      templateInstructions: args.templateInstructions,
    });
    return {
      title: "Audit prompt created",
      output: `Created audit prompt "${args.name}" (id: ${args.id}, category: ${args.category || "general"}).`,
      metadata: { created: true, id: result.prompt.id },
    };
  } catch (e) {
    return {
      title: "Failed to create audit prompt",
      output: `Error: ${(e as Error).message}`,
      metadata: { created: false },
    };
  }
}

async function actionPromptList(args: any, ctx: any) {
  const entries = await ctx.services.listPromptEntries();
  const filtered = args.category
    ? entries.filter((e: any) => e.prompt.category === args.category)
    : entries;
  const lines = filtered.map(
    (e: any) => `  - ${e.prompt.id}: ${e.prompt.name} (${e.prompt.category}, ${e.prompt.auditType})`
  );
  return {
    title: "Audit prompts",
    output: `${filtered.length} audit prompt(s):\n` + lines.join("\n"),
    metadata: { count: filtered.length },
  };
}

async function actionPromptRead(args: any, ctx: any) {
  const result = await ctx.services.readPrompt(args.id);
  if (!result) {
    return {
      title: "Prompt not found",
      output: `No prompt found with id "${args.id}".`,
      metadata: { found: false },
    };
  }
  return {
    title: `Prompt: ${result.prompt.name}`,
    output: JSON.stringify(result.prompt, null, 2),
    metadata: { found: true },
  };
}

async function actionPromptEdit(args: any, ctx: any) {
  const updates: Record<string, string | undefined> = {};
  if (args.name !== undefined) updates.name = args.name;
  if (args.description !== undefined) updates.description = args.description;
  if (args.category !== undefined) updates.category = args.category;
  if (args.auditType !== undefined) updates.auditType = args.auditType;
  if (args.endGoal !== undefined) updates.endGoal = args.endGoal;
  if (args.templateInstructions !== undefined) updates.templateInstructions = args.templateInstructions;

  try {
    const result = await ctx.services.editPrompt(args.id, updates);
    if (!result) {
      return {
        title: "Not found",
        output: `Prompt "${args.id}" not found.`,
        metadata: { updated: false },
      };
    }
    return {
      title: "Audit prompt updated",
      output: `Updated audit prompt "${args.id}".`,
      metadata: { updated: true },
    };
  } catch (e) {
    return {
      title: "Failed to edit prompt",
      output: `Error editing prompt "${args.id}": ${(e as Error).message}`,
      metadata: { updated: false },
    };
  }
}

async function actionPromptDelete(args: any, ctx: any) {
  try {
    const ok = await ctx.services.deletePrompt(args.id);
    if (!ok) {
      return {
        title: "Not found",
        output: `Prompt "${args.id}" not found.`,
        metadata: { deleted: false },
      };
    }
    return {
      title: "Audit prompt deleted",
      output: `Deleted audit prompt "${args.id}".`,
      metadata: { deleted: true },
    };
  } catch (e) {
    return {
      title: "Failed to delete prompt",
      output: `Error deleting prompt "${args.id}": ${(e as Error).message}`,
      metadata: { deleted: false },
    };
  }
}

async function actionList(args: any, ctx: any) {
  const scope = (args.scope || "global") as Scope;
  const entries = await ctx.services.listAudits(scope, ctx.workspaceRoot, ctx.sessionId);
  if (entries.length === 0) {
    return {
      title: "No audits",
      output: `No audits found in "${scope}" scope.`,
      metadata: { count: 0, scope },
    };
  }
  const lines = entries.map(
    (e: any) =>
      `  ${e.name}  — ${e.document.meta.title} (${e.document.meta.auditType}, ${e.document.meta.totalFindings} findings)`
  );
  return {
    title: `${entries.length} audit(s) in ${scope} scope`,
    output: lines.join("\n"),
    metadata: { count: entries.length, scope },
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
    case "delete":
      return actionDelete(args, ctx);
    case "prompt_create":
      return actionPromptCreate(args, ctx);
    case "prompt_list":
      return actionPromptList(args, ctx);
    case "prompt_read":
      return actionPromptRead(args, ctx);
    case "prompt_edit":
      return actionPromptEdit(args, ctx);
    case "prompt_delete":
      return actionPromptDelete(args, ctx);
    case "list":
      return actionList(args, ctx);
  }
  return {
    title: "Invalid action",
    output: `Unknown audit action: "${String(action)}".`,
    metadata: { found: false },
    isError: true,
  };
}
