import { type ReactNode } from "react";
import type { SpecPlanPart, SpecDocument, PlanDocument } from "../../../../lib/api";
import { isPartDone } from "../../lib/plan-status";

/** Count done vs total for a parts array (recursive) */
export function countPartsDone(parts: SpecPlanPart[] | undefined): { done: number; total: number } {
  let done = 0;
  let total = 0;
  if (!Array.isArray(parts)) return { done, total };
  for (const p of parts) {
    if (!p || typeof p !== "object" || typeof (p as { status?: unknown }).status !== "string") continue;
    total++;
    if (isPartDone(p.status)) done++;
    if (Array.isArray(p.parts) && p.parts.length > 0) {
      const sub = countPartsDone(p.parts);
      done += sub.done;
      total += sub.total;
    }
  }
  return { done, total };
}

/** Recursive parts tree for pretty view */
function PartsTree({ parts, depth = 0, showSummary = false }: { parts: SpecPlanPart[]; depth?: number; showSummary?: boolean }) {
  if (!parts || parts.length === 0) return null;
  const { done, total } = showSummary ? countPartsDone(parts) : { done: 0, total: 0 };
  return (
    <div>
      {showSummary && total > 0 && (
        <div className="flex items-center gap-2 text-sm mb-2 px-2 py-1 rounded bg-zinc-800/60">
          <span className={done === total ? "text-emerald-400 font-medium" : "text-zinc-300"}>
            {done === total ? "✓ All" : `${done} of ${total}`} completed
          </span>
          {done < total && (
            <span className="text-zinc-500 text-xs">{total - done} remaining</span>
          )}
          {total > 0 && (
            <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden max-w-[100px]">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
        </div>
      )}
      <ul className="space-y-1" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
        {parts.map((part) => {
          if (!part || typeof part !== "object") return null;
          const done = isPartDone(part.status);
          const subCount = Array.isArray(part.parts) ? countPartsDone(part.parts) : null;
          return (
            <li key={part.id}>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm leading-none ${done ? "text-emerald-400" : "text-zinc-500"}`}>
                  {done ? "✓" : "○"}
                </span>
                <span className="text-sm text-zinc-300">{part.name}</span>
                <span className="text-xs text-zinc-500">{part.type}</span>
                {part.status && (
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                    done ? "bg-emerald-900/50 text-emerald-300" : "bg-amber-900/40 text-amber-400"
                  }`}>
                    {part.status}
                  </span>
                )}
                {part.priority && (
                  <span className={`text-xs ${part.priority === "high" ? "text-amber-500" : "text-zinc-500"}`}>
                    {part.priority}
                  </span>
                )}
                {subCount && subCount.total > 0 && (
                  <span className="text-[11px] text-zinc-600">{subCount.done}/{subCount.total}</span>
                )}
              </div>
              {part.description && <div className="text-sm text-zinc-600 ml-4">{part.description}</div>}
              <PartsTree parts={part.parts} depth={depth + 1} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FieldSection({ label, mono = true, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={mono ? "text-sm text-zinc-300 font-mono whitespace-pre-wrap" : "text-sm text-zinc-300"}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dynamic custom (non-standard) fields                                */
/* ------------------------------------------------------------------ */

/** Doc keys that are part of the standard schema (plus `meta`/`customContent`). */
const SPEC_KNOWN_KEYS = new Set([
  "meta",
  "goal",
  "requirements",
  "constraints",
  "assumptions",
  "acceptanceCriteria",
  "parts",
  "customContent",
]);
const PLAN_KNOWN_KEYS = new Set(["meta", "endGoal", "mainSpec", "tags", "parts", "customContent"]);

/**
 * Collect non-standard fields from a document.
 * Covers both the documented `customContent` bag and any stray top-level keys
 * (e.g. older/manually-authored docs that kept custom keys at the root).
 */
function collectCustomFields(doc: Record<string, unknown>, known: Set<string>): [string, unknown][] {
  const out = new Map<string, unknown>();
  for (const k of Object.keys(doc)) {
    if (!known.has(k)) out.set(k, doc[k]);
  }
  const cc = doc.customContent;
  if (cc && typeof cc === "object" && !Array.isArray(cc)) {
    for (const [k, v] of Object.entries(cc as Record<string, unknown>)) {
      if (!out.has(k)) out.set(k, v);
    }
  }
  return Array.from(out.entries());
}

/** Best-effort value renderer for an arbitrary custom field value. */
function CustomValueView({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <div className="whitespace-pre-wrap break-words">{value}</div>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <div className="font-mono">{String(value)}</div>;
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return (
        <ul className="list-disc list-inside text-sm text-zinc-300 space-y-0.5">
          {value.map((v, i) => <li key={i}>{v}</li>)}
        </ul>
      );
    }
    return <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-zinc-900/50 rounded p-2">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (value && typeof value === "object") {
    return <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-zinc-900/50 rounded p-2">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <div className="font-mono">null</div>;
}

/** Renders the dynamic list of non-standard fields, if any. */
function CustomFieldsSection({ fields }: { fields: [string, unknown][] }) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-3 pt-2 border-t border-zinc-800">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Custom Fields ({fields.length})</div>
      {fields.map(([key, value]) => (
        <FieldSection key={key} label={key} mono={false}>
          <CustomValueView value={value} />
        </FieldSection>
      ))}
    </div>
  );
}

/** Structured read-only view of a spec document */
export function SpecPrettyView({ spec, vNum }: { spec: SpecDocument; vNum: number }) {
  const partCount = spec.parts ? countPartsDone(spec.parts) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-zinc-300">Spec v{vNum}</span>
        <span className="text-xs text-zinc-600 font-mono">{spec.meta?.id}</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          spec.meta?.status === "completed" ? "bg-emerald-900/50 text-emerald-300" :
          "bg-zinc-800 text-zinc-400"
        }`}>{spec.meta?.status || "draft"}</span>
        <span className="text-zinc-500">by <span className="text-zinc-300">{spec.meta?.createdBy || "?"}</span></span>
        <span className="text-zinc-500">
          {spec.meta?.createdAt?.slice(0, 10) || "?"}
          {spec.meta?.updatedAt && spec.meta.updatedAt !== spec.meta?.createdAt && <> · updated {spec.meta.updatedAt.slice(0, 10)}</>}
        </span>
        {partCount && partCount.total > 0 && (
          <span className={`text-xs ml-auto ${partCount.done === partCount.total ? "text-emerald-400" : "text-zinc-400"}`}>
            {partCount.done}/{partCount.total} parts
          </span>
        )}
      </div>
      {spec.meta?.title && <FieldSection label="Title" mono={false}>{spec.meta.title}</FieldSection>}
      {spec.goal && <FieldSection label="Goal">{spec.goal}</FieldSection>}
      {spec.meta?.relatedSpecs?.length > 0 && (
        <FieldSection label="Related Specs" mono={false}>
          <div className="space-y-0.5">{spec.meta.relatedSpecs.map((rs) => <div key={rs} className="text-sm text-blue-400 font-mono">{rs}</div>)}</div>
        </FieldSection>
      )}
      {spec.requirements?.length > 0 && (
        <FieldSection label={`Requirements (${spec.requirements.length})`} mono={false}>
          <ol className="list-decimal list-inside text-sm text-zinc-300 space-y-0.5">
            {spec.requirements.map((r, i) => <li key={i} className="text-sm">{r}</li>)}
          </ol>
        </FieldSection>
      )}
      {spec.constraints?.length > 0 && (
        <FieldSection label={`Constraints (${spec.constraints.length})`} mono={false}>
          <ul className="list-disc list-inside text-sm text-zinc-300 space-y-0.5">
            {spec.constraints.map((c, i) => <li key={i} className="text-sm">{c}</li>)}
          </ul>
        </FieldSection>
      )}
      {spec.assumptions?.length > 0 && (
        <FieldSection label={`Assumptions (${spec.assumptions.length})`} mono={false}>
          <ul className="list-disc list-inside text-sm text-zinc-300 space-y-0.5">
            {spec.assumptions.map((a, i) => <li key={i} className="text-sm">{a}</li>)}
          </ul>
        </FieldSection>
      )}
      {spec.acceptanceCriteria?.length > 0 && (
        <FieldSection label={`Acceptance Criteria (${spec.acceptanceCriteria.length})`} mono={false}>
          <ul className="space-y-1">
            {spec.acceptanceCriteria.map((ac, i) => (
              <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                <span className="mt-0.5 text-zinc-500 text-base leading-none">☐</span>
                <span>{ac}</span>
              </li>
            ))}
          </ul>
        </FieldSection>
      )}
      {spec.parts?.length > 0 && (
        <FieldSection label={`Parts (${spec.parts.length})`} mono={false}>
          <PartsTree parts={spec.parts} showSummary />
        </FieldSection>
      )}
      <CustomFieldsSection fields={collectCustomFields(spec as unknown as Record<string, unknown>, SPEC_KNOWN_KEYS)} />
    </div>
  );
}

/** Structured read-only view of a plan document */
export function PlanPrettyView({ plan, vNum }: { plan: PlanDocument; vNum: number }) {
  const partCount = plan.parts ? countPartsDone(plan.parts) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-zinc-300">Plan v{vNum}</span>
        <span className="text-xs text-zinc-600 font-mono">{plan.meta?.id}</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          plan.meta?.status === "completed" ? "bg-emerald-900/50 text-emerald-300" :
          "bg-zinc-800 text-zinc-400"
        }`}>{plan.meta?.status || "draft"}</span>
        <span className="text-zinc-500">by <span className="text-zinc-300">{plan.meta?.createdBy || "?"}</span></span>
        <span className="text-zinc-500">
          {plan.meta?.createdAt?.slice(0, 10) || "?"}
          {plan.meta?.updatedAt && plan.meta.updatedAt !== plan.meta?.createdAt && <> · updated {plan.meta.updatedAt.slice(0, 10)}</>}
        </span>
        {partCount && partCount.total > 0 && (
          <span className={`text-xs ml-auto ${partCount.done === partCount.total ? "text-emerald-400" : "text-zinc-400"}`}>
            {partCount.done}/{partCount.total} parts
          </span>
        )}
      </div>
      {plan.meta?.title && <FieldSection label="Title" mono={false}>{plan.meta.title}</FieldSection>}
      {plan.endGoal && <FieldSection label="End Goal">{plan.endGoal}</FieldSection>}
      {plan.meta?.tags?.length > 0 && (
        <FieldSection label="Tags" mono={false}>
          <div className="flex flex-wrap gap-1">{plan.meta.tags.map((t) => <span key={t} className="text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{t}</span>)}</div>
        </FieldSection>
      )}
      {plan.meta?.mainSpec && <FieldSection label="Main Spec" mono={false}><span className="text-sm text-blue-400 font-mono">{plan.meta.mainSpec}</span></FieldSection>}
      {plan.meta?.relatedSpecs?.length > 0 && (
        <FieldSection label="Related Specs" mono={false}>
          <div className="space-y-0.5">{plan.meta.relatedSpecs.map((rs) => <div key={rs} className="text-sm text-blue-400 font-mono">{rs}</div>)}</div>
        </FieldSection>
      )}
      {plan.parts?.length > 0 && (
        <FieldSection label={`Parts (${plan.parts.length})`} mono={false}>
          <PartsTree parts={plan.parts} showSummary />
        </FieldSection>
      )}
      <CustomFieldsSection fields={collectCustomFields(plan as unknown as Record<string, unknown>, PLAN_KNOWN_KEYS)} />
    </div>
  );
}
