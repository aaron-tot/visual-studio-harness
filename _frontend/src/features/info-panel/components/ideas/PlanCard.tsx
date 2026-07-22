import { Archive, ChevronDown, ChevronRight, Copy, Folder, Trash2 } from "lucide-react";
import type { PlanEntry } from "../../../../lib/api";
import type { DocMode, InjectSub } from "../../types";
import { countPartsProgress } from "../../lib/plan-status";
import { PanelButton } from "../ui";
import { PlanActions } from "./PlanActions";
import { SpecPlanDocView } from "./SpecPlanTree";
import { AbandonForm } from "./AbandonForm";

interface PlanCardProps {
  plan: PlanEntry;
  expanded: boolean;
  /** Flat global list — no nested indent under a group header */
  flatHeader?: boolean;
  onToggle: () => void;
  busy: boolean;
  abandoning: boolean;
  abandonReason: string;
  abandonSuccessor: string;
  onAbandonReason: (v: string) => void;
  onAbandonSuccessor: (v: string) => void;
  onStartAbandon: () => void;
  onCancelAbandon: () => void;
  onConfirmAbandon: () => void;
  onAddVersion: (mode: DocMode) => void;
  isInjected: (mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
  onDelete: () => void;
  onArchive: () => void;
}

export function PlanCard({
  plan,
  expanded,
  flatHeader = false,
  onToggle,
  busy,
  abandoning,
  abandonReason,
  abandonSuccessor,
  onAbandonReason,
  onAbandonSuccessor,
  onStartAbandon,
  onCancelAbandon,
  onConfirmAbandon,
  onAddVersion,
  isInjected,
  onToggleInject,
  onResult,
  onDelete,
  onArchive,
}: PlanCardProps) {
  const abandoned = !!plan.meta?.abandoned;
  const progress = countPartsProgress(plan);

  return (
    <div className={abandoned ? "opacity-60" : undefined}>
      <div
        className={`w-full flex items-center gap-1 pr-3 py-1.5 hover:bg-zinc-900 transition-colors group cursor-pointer ${
          flatHeader ? "px-3" : "pl-6"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-zinc-600" />
        )}
        <span className="text-xs text-zinc-300 truncate flex-1">
          {plan.name}
          {abandoned && (
            <span className="ml-1 text-[9px] text-zinc-600">(abandoned)</span>
          )}
        </span>
        {progress && (
          <span className="text-[10px] text-zinc-600 shrink-0">{progress}</span>
        )}
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(`plans/${plan.name}`);
            onResult("Path copied");
          }}
          title="Copy relative path"
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(plan.path);
            onResult("Full path copied");
          }}
          title="Copy full path"
        >
          <Folder size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          title="Archive idea"
        >
          <Archive size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete idea permanently"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2 space-y-1" onClick={(e) => e.stopPropagation()}>
          {!abandoned && (
            <div className="flex gap-1 pb-1.5 border-b border-zinc-800">
              <PanelButton
                className="flex-1 py-1"
                disabled={busy}
                onClick={() => onAddVersion("spec")}
              >
                + Spec{plan.specs.length === 0 ? "" : ` v${plan.specs.length + 1}`}
              </PanelButton>
              <PanelButton
                className="flex-1 py-1"
                disabled={busy}
                onClick={() => onAddVersion("plan")}
              >
                + Plan{plan.plans.length === 0 ? "" : ` v${plan.plans.length + 1}`}
              </PanelButton>
            </div>
          )}

          <PlanActions
            plan={plan}
            isInjected={isInjected}
            onToggleInject={onToggleInject}
            onResult={onResult}
          />

          {plan.specs.length > 0 && (
            <SpecPlanDocView
              label="Spec"
              version={plan.specs.length}
              doc={plan.specs[plan.specs.length - 1]}
            />
          )}
          {plan.plans.length > 0 && (
            <SpecPlanDocView
              label="Plan"
              version={plan.plans.length}
              doc={plan.plans[plan.plans.length - 1]}
            />
          )}

          {plan.files.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-semibold text-zinc-500 mb-0.5">Files</div>
              {plan.files.map((f) => (
                <div
                  key={f}
                  className="text-[10px] text-zinc-600 pl-2 border-l border-zinc-800"
                >
                  {f}
                </div>
              ))}
            </div>
          )}

          {abandoned && plan.meta.abandoned && (
            <div className="text-[10px] text-zinc-600 pt-1 space-y-0.5">
              <div>Abandoned: {plan.meta.abandoned.reason}</div>
              {plan.meta.abandoned.successor && (
                <div>Successor: {plan.meta.abandoned.successor}</div>
              )}
            </div>
          )}

          {!abandoned && (
            abandoning ? (
              <AbandonForm
                reason={abandonReason}
                successor={abandonSuccessor}
                busy={busy}
                onReasonChange={onAbandonReason}
                onSuccessorChange={onAbandonSuccessor}
                onConfirm={onConfirmAbandon}
                onCancel={onCancelAbandon}
              />
            ) : (
              <button
                type="button"
                className="text-[9px] text-zinc-700 hover:text-zinc-400 transition-colors pt-1"
                onClick={onStartAbandon}
              >
                Abandon idea…
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
