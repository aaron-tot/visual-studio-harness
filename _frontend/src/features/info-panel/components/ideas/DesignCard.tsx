import { useCallback, useState } from "react";
import { ArrowRightFromLine, ChevronDown, ChevronRight, Copy, FileJson, Folder, Trash2 } from "lucide-react";
import type { PlanEntry, DocMode, DesignLocation, InjectSub, PlanScope } from "../../types";
import { countPartsProgress } from "../../lib/plan-status";
import { scopeApiParams } from "../../lib/scope-params";
import { updateDocViaApi } from "../../../../lib/api";
import { PanelButton } from "../ui";
import { PlanActions } from "./PlanActions";
import { DesignJsonModal } from "./DesignJsonModal";
import { AbandonForm } from "./AbandonForm";
import { MoveScopeModal } from "../MoveScopeModal";

interface DesignCardProps {
  plan: PlanEntry;
  expanded: boolean;
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
  onMove: (toScope: PlanScope) => void;
  isInjected: (mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  location: DesignLocation;
  onRefresh: () => void;
}

export function DesignCard({
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
  onMove,
  isInjected,
  onToggleInject,
  onResult,
  onDelete,
  onArchive,
  location,
  onRefresh,
}: DesignCardProps) {
  const [editingDoc, setEditingDoc] = useState<{ type: "spec" | "plan"; version: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showMove, setShowMove] = useState(false);

  const handleEdit = useCallback((type: "spec" | "plan", version: number) => {
    setEditingDoc({ type, version });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingDoc(null);
  }, []);

  const handleSave = useCallback(
    async (fields: Record<string, unknown>) => {
      if (!editingDoc) return;
      setSaving(true);
      try {
        await updateDocViaApi({
          name: plan.name,
          docType: editingDoc.type,
          version: editingDoc.version,
          fields,
          ...scopeApiParams(location),
        });
        onResult(`${editingDoc.type === "spec" ? "Spec" : "Plan"} v${editingDoc.version} saved`);
        setEditingDoc(null);
        onRefresh();
      } catch (err) {
        onResult(`Error: ${err instanceof Error ? err.message : "save failed"}`);
      } finally {
        setSaving(false);
      }
    },
    [editingDoc, plan.name, location, onResult, onRefresh]
  );

  const abandoned = !!plan.meta?.abandoned;
  const progress = countPartsProgress(plan);

  return (
    <>
      <div className={abandoned ? "opacity-60" : undefined}>
      {/* Header row */}
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
        <button
          type="button"
          className="text-zinc-500 hover:text-white shrink-0"
          onClick={(e) => { e.stopPropagation(); setShowJson(true); }}
          title="Open in design modal"
        >
          <FileJson size={12} />
        </button>
        <span className="text-xs text-zinc-300 truncate flex-1">
          {plan.name}
          {abandoned && <span className="ml-1 text-[9px] text-zinc-600">(abandoned)</span>}
        </span>
        {progress && (
          <span className="text-[10px] text-zinc-600 shrink-0">{progress}</span>
        )}
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(`plans/${plan.name}`); onResult("Path copied"); }}
          title="Copy relative path"
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(plan.path); onResult("Full path copied"); }}
          title="Copy full path"
        >
          <Folder size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          title="Archive design"
        >
          <Trash2 size={12} />
        </button>
        <button
          type="button"
          className="text-[10px] px-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete design permanently"
        >
          <Trash2 size={12} />
        </button>
        <button
          type="button"
          className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-sky-700 hover:text-sky-200 transition-colors shrink-0"
          disabled={busy}
          onClick={(e) => { e.stopPropagation(); setShowMove(true); }}
          title="Move to another scope"
        >
          <ArrowRightFromLine size={10} className="inline mr-0.5" />
          Move
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1" onClick={(e) => e.stopPropagation()}>
          {!abandoned && (
            <div className="flex gap-1 pb-1.5 border-b border-zinc-800">
              <PanelButton className="flex-1 py-1" disabled={busy} onClick={() => onAddVersion("spec")}>
                + Spec{plan.specs.length === 0 ? "" : ` v${plan.specs.length + 1}`}
              </PanelButton>
              <PanelButton className="flex-1 py-1" disabled={busy} onClick={() => onAddVersion("plan")}>
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

          {plan.files.length > 0 && (
            <div className="pt-1">
              <div className="text-[10px] font-semibold text-zinc-500 mb-0.5">Files</div>
              {plan.files.map((f) => (
                <div key={f} className="text-[10px] text-zinc-600 pl-2 border-l border-zinc-800">{f}</div>
              ))}
            </div>
          )}

          {abandoned && plan.meta.abandoned && (
            <div className="text-[10px] text-zinc-600 pt-1 space-y-0.5">
              <div>Abandoned: {plan.meta.abandoned.reason}</div>
              {plan.meta.abandoned.successor && <div>Successor: {plan.meta.abandoned.successor}</div>}
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
                Abandon design…
              </button>
            )
          )}
        </div>
      )}

      {/* Design JSON viewer modal */}
      {showJson && (
        <DesignJsonModal
          plan={plan}
          onClose={() => setShowJson(false)}
          onAddVersion={onAddVersion}
          location={location}
          onRefresh={onRefresh}
          onResult={onResult}
        />
      )}

      {/* Move to scope modal — sibling of the card div so abandoned opacity-60 does not apply */}
      {showMove && (
        <MoveScopeModal
          title={`Move design "${plan.name}"`}
          currentScope={location.scope}
          onClose={() => setShowMove(false)}
          onMove={(toScope) => {
            setShowMove(false);
            onMove(toScope);
          }}
        />
      )}
      </div>
    </>
  );
}
