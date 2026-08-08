import { useState } from "react";
import { ArrowRightFromLine, ChevronDown, ChevronRight, Copy, ExternalLink, Trash2 } from "lucide-react";
import type { AuditEntry, AuditDocument } from "../../../../lib/api";
import type { DesignLocation, PlanScope } from "../../types";
import { AuditJsonModal } from "./AuditJsonModal";
import { MoveScopeModal } from "../MoveScopeModal";

interface AuditCardProps {
  audit: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onDelete: () => void;
  onMove: (toScope: PlanScope) => void;
  onSave?: (name: string, document: AuditDocument) => void;
  location: DesignLocation;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-zinc-500",
};

function SeverityDot({ severity }: { severity: string }) {
  const color = severityColors[severity] || "bg-zinc-500";
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${color} shrink-0`}
      title={severity}
    />
  );
}

export function AuditCard({
  audit,
  expanded,
  onToggle,
  busy,
  onDelete,
  onMove,
  onSave,
  location,
}: AuditCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const m = audit.document.meta;
  const isImplCheck = m.auditType === "implementation_completed";
  const hasAssessments = m.assessments && m.assessments.length > 0;
  const topFindings = audit.document.findings.slice(0, 5);
  const remaining = audit.document.findings.length - 5;

  const statusColor = (s: string) => {
    if (s === "pass") return "text-emerald-500";
    if (s === "partial") return "text-amber-500";
    return "text-red-500";
  };

  const assessmentStatusIcon = (s: string) => {
    if (s === "implemented_as_expected") return "✅";
    if (s === "implemented_differently") return "⚠️";
    return "❌";
  };

  const handleCopyReport = (e: React.MouseEvent) => {
    e.stopPropagation();
    const raw = JSON.stringify(audit.document, null, 2);
    navigator.clipboard.writeText(raw).catch(() => {});
  };

  return (
    <div>
      {/* Header */}
      <div
        className="w-full flex items-center gap-1.5 pr-3 py-1.5 hover:bg-zinc-900 transition-colors group cursor-pointer px-3"
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

        {/* Severity bar */}
        <div className="flex gap-px shrink-0">
          {(["critical", "high", "medium", "low", "info"] as const).map((s) => {
            const count = m[`${s}Count` as keyof typeof m] as number;
            if (!count) return null;
            return <SeverityDot key={s} severity={s} />;
          })}
        </div>

        <span className="text-xs text-zinc-300 truncate flex-1">{m.title}</span>

        {/* Audit type badge */}
        <span className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase shrink-0">
          {m.auditType === "implementation_completed" ? "impl" : m.auditType === "general_audit" ? "audit" : m.auditType.slice(0, 6)}
        </span>

        <span className="text-[9px] text-zinc-600 shrink-0">
          {new Date(m.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-6 pb-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          {/* Summary */}
          <div className="text-[10px] text-zinc-400 leading-relaxed">{m.summary}</div>

          {/* Overall status for implementation_completed */}
          {m.overallStatus && (
            <div className={`text-[10px] font-semibold ${statusColor(m.overallStatus)}`}>
              Overall: {m.overallStatus.toUpperCase()}
              {m.overallAssessment && (
                <span className="font-normal text-zinc-400 ml-1">— {m.overallAssessment}</span>
              )}
            </div>
          )}

          {/* End goal for general audits */}
          {m.endGoal && (
            <div className="text-[9px] text-zinc-600 font-mono leading-snug border-l-2 border-zinc-700 pl-2">
              🎯 {m.endGoal}
            </div>
          )}

          {/* Assessments for implementation_completed */}
          {hasAssessments && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-zinc-600 font-semibold uppercase tracking-wider">Assessments</div>
              {m.assessments!.map((a, i) => (
                <div key={i} className="flex items-start gap-1 text-[10px]">
                  <span className="shrink-0">{assessmentStatusIcon(a.status)}</span>
                  <span className="text-zinc-300">{a.aspectName}</span>
                  {a.status !== "implemented_as_expected" && (
                    <span className="text-zinc-500 ml-1">— {a.status.replace(/_/g, " ")}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Top findings preview */}
          {topFindings.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-[9px] text-zinc-600 font-semibold uppercase tracking-wider">
                Findings ({audit.document.findings.length})
              </div>
              {topFindings.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px]">
                  <SeverityDot severity={f.severity} />
                  <span className="text-zinc-400 truncate">
                    {f.severity.toUpperCase()}: {f.title}
                    {f.file && <span className="text-zinc-600 ml-1">— {f.file}{f.line ? `:${f.line}` : ""}</span>}
                  </span>
                </div>
              ))}
              {remaining > 0 && (
                <div className="text-[9px] text-zinc-600 italic">
                  …and {remaining} more finding{remaining > 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}

          {/* Attachments */}
          {m.attachments && m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {m.attachments.map((att, i) => (
                <span
                  key={i}
                  className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700"
                >
                  {att.label || att.designName || "attached"}
                  {att.specName && ` / ${att.specName}`}
                  {att.planName && ` / ${att.planName}`}
                </span>
              ))}
            </div>
          )}

          {/* Agent model */}
          {m.agentModel && (
            <div className="text-[8px] text-zinc-600">Agent: {m.agentModel}</div>
          )}

          {/* Actions */}
          <div className="flex gap-1 pt-1">
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              onClick={() => setShowModal(true)}
              title="View full audit report"
            >
              <ExternalLink size={10} className="inline mr-0.5" />
              View
            </button>
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
              disabled={busy}
              onClick={handleCopyReport}
              title="Copy audit JSON to clipboard"
            >
              <Copy size={10} className="inline mr-0.5" />
              Copy
            </button>
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-sky-700 hover:text-sky-200 transition-colors"
              disabled={busy}
              onClick={() => setShowMove(true)}
              title="Move to another scope"
            >
              <ArrowRightFromLine size={10} className="inline mr-0.5" />
              Move
            </button>
            <button
              type="button"
              className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-red-700 hover:text-red-200 transition-colors"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={10} className="inline mr-0.5" />
              Delete
            </button>
          </div>

          {/* Modal */}
          {showModal && <AuditJsonModal audit={audit} onClose={() => setShowModal(false)} onSave={(name, doc) => { onSave?.(name, doc); setShowModal(false); }} />}
          {showMove && (
            <MoveScopeModal
              title={`Move audit "${m.title}"`}
              currentScope={location.scope}
              onClose={() => setShowMove(false)}
              onMove={(toScope) => {
                setShowMove(false);
                onMove(toScope);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
