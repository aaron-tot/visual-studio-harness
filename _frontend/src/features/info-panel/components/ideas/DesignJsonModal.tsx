import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { PlanEntry } from "../../../../lib/api";
import type { DocMode, DesignLocation } from "../../types";
import { VersionCard } from "./VersionCard";

interface DesignJsonModalProps {
  plan: PlanEntry;
  onClose: () => void;
  onAddVersion?: (mode: DocMode) => void;
  location?: DesignLocation;
  onRefresh?: () => void;
  onResult?: (msg: string) => void;
}

export function DesignJsonModal({ plan, onClose, onAddVersion, location, onRefresh, onResult }: DesignJsonModalProps) {
  const [tab, setTab] = useState<"overview" | "specs" | "plans">("overview");

  const maxVersion = Math.max(
    plan.specs.length > 0 ? plan.specs.length : 0,
    plan.plans.length > 0 ? plan.plans.length : 0
  );
  const [selectedVersion, setSelectedVersion] = useState(maxVersion);

  const selectedSpec = selectedVersion > 0 && selectedVersion <= plan.specs.length
    ? plan.specs[selectedVersion - 1]
    : null;
  const selectedPlanDoc = selectedVersion > 0 && selectedVersion <= plan.plans.length
    ? plan.plans[selectedVersion - 1]
    : null;

  const versionNumbers = maxVersion > 0
    ? Array.from({ length: maxVersion }, (_, i) => i + 1)
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-y-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-zinc-200">{plan.name}</h2>
            {versionNumbers.length > 0 && (
              <select
                className="bg-zinc-800 text-zinc-300 text-sm rounded px-2 py-0.5 border border-zinc-700"
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
              >
                {versionNumbers.map((v) => (
                  <option key={v} value={v}>v{v}</option>
                ))}
              </select>
            )}
          </div>
          <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-4 pt-2 border-b border-zinc-800 shrink-0">
          {(["overview", "specs", "plans"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`text-sm px-3 py-1.5 border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-600 hover:text-zinc-400"
              }`}
              onClick={() => setTab(t)}
            >
              {t === "overview" ? "Overview" : t === "specs" ? `Specs (${plan.specs.length})` : `Plans (${plan.plans.length})`}
            </button>
          ))}
        </div>

        {/* Version status bar */}
        {maxVersion > 0 && (
          <div className="shrink-0 flex items-center gap-4 px-4 py-2 text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-900/50">
            <span className="text-zinc-400 font-medium">v{selectedVersion} of {maxVersion}</span>
            <span>Spec: {selectedSpec ? `v${selectedVersion}` : "—"}</span>
            <span>Plan: {selectedPlanDoc ? `v${selectedVersion}` : "—"}</span>
            {plan.files.length > 0 && <span>{plan.files.length} file{plan.files.length !== 1 ? "s" : ""}</span>}
            <div className="ml-auto flex gap-1">
              {onAddVersion && (
                <>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                    onClick={() => onAddVersion("spec")}
                  >
                    + Spec v{plan.specs.length + 1}
                  </button>
                  <button
                    type="button"
                    className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                    onClick={() => onAddVersion("plan")}
                  >
                    + Plan v{plan.plans.length + 1}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {tab === "overview" && (
            <OverviewContent plan={plan} selectedVersion={selectedVersion} selectedSpec={selectedSpec} selectedPlanDoc={selectedPlanDoc} />
          )}
          {tab === "specs" && (
            selectedSpec ? (
              <VersionCard label={`Spec v${selectedVersion}`} doc={selectedSpec} version={selectedVersion} docType="spec" planName={plan.name} location={location} onRefresh={onRefresh} onResult={onResult} />
            ) : (
              <div className="text-sm text-zinc-600">No spec for version {selectedVersion}</div>
            )
          )}
          {tab === "plans" && (
            selectedPlanDoc ? (
              <VersionCard label={`Plan v${selectedVersion}`} doc={selectedPlanDoc} version={selectedVersion} docType="plan" planName={plan.name} location={location} onRefresh={onRefresh} onResult={onResult} />
            ) : (
              <div className="text-sm text-zinc-600">No plan for version {selectedVersion}</div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function OverviewContent({
  plan, selectedVersion, selectedSpec, selectedPlanDoc,
}: {
  plan: PlanEntry;
  selectedVersion: number;
  selectedSpec: PlanEntry["specs"][0] | null;
  selectedPlanDoc: PlanEntry["plans"][0] | null;
}) {
  return (
    <div className="space-y-5">
      {selectedSpec && (
        <div>
          <div className="text-[15px] font-semibold text-zinc-300 mb-2">Spec v{selectedVersion}</div>
          <div className="border border-zinc-800 rounded px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-zinc-600 font-mono truncate">{plan.path}/specV{selectedVersion}.json</span>
            </div>
            <div className="text-sm text-zinc-400">{selectedSpec.goal?.slice(0, 200) || "(no goal)"}</div>
            <div className="text-xs text-zinc-600 mt-1">
              Status: {selectedSpec.meta?.status || "draft"}
              {selectedSpec.requirements?.length ? ` · ${selectedSpec.requirements.length} requirements` : ""}
              {selectedSpec.parts?.length ? ` · ${selectedSpec.parts.length} parts` : ""}
            </div>
          </div>
        </div>
      )}
      {selectedPlanDoc && (
        <div>
          <div className="text-[15px] font-semibold text-zinc-300 mb-2">Plan v{selectedVersion}</div>
          <div className="border border-zinc-800 rounded px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-zinc-600 font-mono truncate">{plan.path}/planV{selectedVersion}.json</span>
            </div>
            <div className="text-sm text-zinc-400">{selectedPlanDoc.endGoal?.slice(0, 200) || "(no end goal)"}</div>
            <div className="text-xs text-zinc-600 mt-1">
              Status: {selectedPlanDoc.meta?.status || "draft"}
              {selectedPlanDoc.parts?.length ? ` · ${selectedPlanDoc.parts.length} parts` : ""}
            </div>
          </div>
        </div>
      )}
      {plan.files.length > 0 && (
        <div>
          <div className="text-[15px] font-semibold text-zinc-300 mb-1">Files</div>
          <div className="text-sm text-zinc-600 space-y-0.5">{plan.files.map((f) => <div key={f}>{f}</div>)}</div>
        </div>
      )}
      {plan.meta?.abandoned && (
        <div className="text-sm text-amber-600">
          Abandoned: {plan.meta.abandoned.reason}
          {plan.meta.abandoned.successor && <span> → {plan.meta.abandoned.successor}</span>}
          {plan.meta.abandoned.timestamp && <span className="text-zinc-600"> · {plan.meta.abandoned.timestamp.slice(0, 10)}</span>}
        </div>
      )}
    </div>
  );
}
