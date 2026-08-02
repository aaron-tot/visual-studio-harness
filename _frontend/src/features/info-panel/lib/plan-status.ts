import type { SpecPlanPart } from "../../../lib/api";

const DONE_STATUSES = new Set([
  "completed",
  "cancelled",
  "abandoned",
  "redundant",
  "deferred",
]);

export function isPartDone(status: string | undefined): boolean {
  return !!status && DONE_STATUSES.has(status);
}

function isPart(p: unknown): p is SpecPlanPart {
  return !!p && typeof p === "object" && typeof (p as { status?: unknown }).status === "string";
}

function safeParts(parts: SpecPlanPart[] | undefined): SpecPlanPart[] {
  return Array.isArray(parts) ? parts.filter(isPart) : [];
}

export function countCompleted(parts: SpecPlanPart[] | undefined): string {
  const safe = safeParts(parts);
  const total = safe.length;
  const done = safe.filter((p) => isPartDone(p.status)).length;
  return `${done}/${total}`;
}

export function countPartsProgress(plan: {
  specs: Array<{ parts?: SpecPlanPart[] }>;
  plans: Array<{ parts?: SpecPlanPart[] }>;
}): string {
  const allParts = [
    ...safeParts(plan.specs?.flatMap((s) => s.parts)),
    ...safeParts(plan.plans?.flatMap((p) => p.parts)),
  ];
  if (allParts.length === 0) return "";
  const done = allParts.filter((p) => isPartDone(p.status)).length;
  return `${done}/${allParts.length}`;
}
