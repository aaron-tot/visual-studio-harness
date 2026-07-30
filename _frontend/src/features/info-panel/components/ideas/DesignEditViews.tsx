import { useCallback } from "react";
import type { SpecDocument, PlanDocument, SpecPlanPart } from "../../../../lib/api";
import { StringField, EditableStringList, EditablePartsField } from "./DesignEditFields";

/* ------------------------------------------------------------------ */
/*  EditableSpecView                                                   */
/* ------------------------------------------------------------------ */

export function EditableSpecView({
  spec,
  vNum,
  onChange,
}: {
  spec: SpecDocument;
  vNum: number;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const onGoal = useCallback((v: string) => onChange({ goal: v }), [onChange]);
  const onReqs = useCallback((v: string[]) => onChange({ requirements: v }), [onChange]);
  const onCons = useCallback((v: string[]) => onChange({ constraints: v }), [onChange]);
  const onAssumptions = useCallback((v: string[]) => onChange({ assumptions: v }), [onChange]);
  const onCriteria = useCallback((v: string[]) => onChange({ acceptanceCriteria: v }), [onChange]);
  const onParts = useCallback((v: SpecPlanPart[]) => onChange({ parts: v }), [onChange]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-zinc-300">
          Spec v{vNum}
          <span className="text-xs text-amber-400 font-normal ml-2">(editing)</span>
        </span>
      </div>

      <StringField label="Goal" value={spec.goal || ""} onChange={onGoal} multiline />

      <EditableStringList label="Requirements" items={spec.requirements || []} onChange={onReqs} />
      <EditableStringList label="Constraints" items={spec.constraints || []} onChange={onCons} />
      <EditableStringList label="Assumptions" items={spec.assumptions || []} onChange={onAssumptions} />
      <EditableStringList label="Acceptance Criteria" items={spec.acceptanceCriteria || []} onChange={onCriteria} />
      <EditablePartsField label="Parts" parts={spec.parts || []} onChange={onParts} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditablePlanView                                                   */
/* ------------------------------------------------------------------ */

export function EditablePlanView({
  plan,
  vNum,
  onChange,
}: {
  plan: PlanDocument;
  vNum: number;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const onGoal = useCallback((v: string) => onChange({ endGoal: v }), [onChange]);
  const onTags = useCallback(
    (v: string[]) => onChange({ meta: { ...(plan.meta || {}), tags: v } }),
    [onChange, plan.meta],
  );
  const onParts = useCallback((v: SpecPlanPart[]) => onChange({ parts: v }), [onChange]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-zinc-300">
          Plan v{vNum}
          <span className="text-xs text-amber-400 font-normal ml-2">(editing)</span>
        </span>
      </div>

      <StringField label="End Goal" value={plan.endGoal || ""} onChange={onGoal} multiline />
      <EditableStringList label="Tags" items={plan.meta?.tags || []} onChange={onTags} />
      <EditablePartsField label="Parts" parts={plan.parts || []} onChange={onParts} />
    </div>
  );
}
