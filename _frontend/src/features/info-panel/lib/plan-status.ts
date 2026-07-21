import type { SpecPlanPart } from "../../../lib/api";

const DONE_STATUSES = new Set([
  "completed",
  "cancelled",
  "abandoned",
  "redundant",
  "deferred",
]);

export function isPartDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}

export function countCompleted(parts: SpecPlanPart[]): string {
  const total = parts.length;
  const done = parts.filter((p) => isPartDone(p.status)).length;
  return `${done}/${total}`;
}

export function countPartsProgress(plan: {
  specs: Array<{ parts: SpecPlanPart[] }>;
  plans: Array<{ parts: SpecPlanPart[] }>;
}): string {
  const allParts = [
    ...plan.specs.flatMap((s) => s.parts),
    ...plan.plans.flatMap((p) => p.parts),
  ];
  if (allParts.length === 0) return "";
  const done = allParts.filter((p) => isPartDone(p.status)).length;
  return `${done}/${allParts.length}`;
}
