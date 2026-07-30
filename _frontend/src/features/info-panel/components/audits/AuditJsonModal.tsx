import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { AuditEntry } from "../../../../lib/api";

interface AuditJsonModalProps {
  audit: AuditEntry;
  onClose: () => void;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-zinc-500",
};

export function AuditJsonModal({ audit, onClose }: AuditJsonModalProps) {
  const [tab, setTab] = useState<"overview" | "findings" | "raw">("overview");
  const m = audit.document.meta;
  const isImplCheck = m.auditType === "implementation_completed";
  const hasAssessments = m.assessments && m.assessments.length > 0;
  const hasAttachments = m.attachments && m.attachments.length > 0;

  const statusColor = (s: string) => {
    if (s === "pass") return "text-emerald-400";
    if (s === "partial") return "text-amber-400";
    return "text-red-400";
  };

  const assessmentIcon = (s: string) => {
    if (s === "implemented_as_expected") return "✅";
    if (s === "implemented_differently") return "⚠️";
    return "❌";
  };

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
            <h2 className="text-base font-semibold text-zinc-200">{m.title}</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase">
              {m.auditType}
            </span>
          </div>
          <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-4 pt-2 border-b border-zinc-800 shrink-0">
          {(["overview", "findings", "raw"] as const).map((t) => (
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
              {t === "overview"
                ? "Overview"
                : t === "findings"
                  ? `Findings (${audit.document.findings.length})`
                  : "Raw JSON"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {tab === "overview" && (
            <div className="space-y-4">
              {/* Summary */}
              <div>
                <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Summary</div>
                <div className="text-sm text-zinc-300 leading-relaxed">{m.summary}</div>
              </div>

              {/* Severity counts */}
              <div>
                <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Findings</div>
                <div className="flex gap-2">
                  {(["critical", "high", "medium", "low", "info"] as const).map((s) => {
                    const count = m[`${s}Count` as keyof typeof m] as number;
                    if (!count) return null;
                    return (
                      <div key={s} className="flex items-center gap-1 text-xs">
                        <span className={`inline-block w-2 h-2 rounded-full ${severityColors[s]}`} />
                        <span className="text-zinc-400">{count} {s}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Overall status */}
              {m.overallStatus && (
                <div>
                  <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Overall Status</div>
                  <div className={`text-sm font-semibold ${statusColor(m.overallStatus)}`}>
                    {m.overallStatus.toUpperCase()}
                  </div>
                  {m.overallAssessment && (
                    <div className="text-sm text-zinc-400 mt-1">{m.overallAssessment}</div>
                  )}
                </div>
              )}

              {/* Assessments */}
              {hasAssessments && (
                <div>
                  <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Per-Aspect Assessments</div>
                  <div className="space-y-1">
                    {m.assessments!.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm border border-zinc-800 rounded px-3 py-2">
                        <span className="shrink-0 mt-0.5">{assessmentIcon(a.status)}</span>
                        <div>
                          <div className="text-zinc-300">{a.aspectName}</div>
                          <div className="text-[11px] text-zinc-600">
                            {a.expectedBehavior && <span>Expected: {a.expectedBehavior}</span>}
                            {a.actualImplementation && <span> · Actual: {a.actualImplementation}</span>}
                          </div>
                          {a.fileReferences && a.fileReferences.length > 0 && (
                            <div className="text-[10px] text-zinc-700 mt-0.5">
                              Files: {a.fileReferences.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* End goal */}
              {m.endGoal && (
                <div>
                  <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">End Goal</div>
                  <div className="text-sm text-zinc-400 border-l-2 border-zinc-700 pl-3">{m.endGoal}</div>
                </div>
              )}

              {/* Attachments */}
              {hasAttachments && (
                <div>
                  <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Attachments</div>
                  <div className="flex flex-wrap gap-2">
                    {m.attachments!.map((att, i) => (
                      <div key={i} className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                        {att.label || att.designName || "attached"}
                        {att.specName && <span className="text-zinc-600"> / {att.specName}</span>}
                        {att.planName && <span className="text-zinc-600"> / {att.planName}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div>
                <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1">Metadata</div>
                <div className="text-xs text-zinc-600 space-y-0.5">
                  <div>Scope: {m.scope}</div>
                  <div>Created: {m.createdAt}</div>
                  <div>By: {m.createdBy}</div>
                  {m.agentModel && <div>Agent: {m.agentModel}</div>}
                  {m.workspaceRoot && <div>Workspace: {m.workspaceRoot}</div>}
                  {m.sessionId && <div>Session: {m.sessionId}</div>}
                </div>
              </div>
            </div>
          )}

          {tab === "findings" && (
            <div className="space-y-2">
              {audit.document.findings.length === 0 && (
                <div className="text-sm text-zinc-600">No findings.</div>
              )}
              {audit.document.findings.map((f, i) => (
                <div key={i} className="border border-zinc-800 rounded px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${severityColors[f.severity]}`} />
                    <span className="text-xs font-semibold text-zinc-300">{f.severity.toUpperCase()}</span>
                    <span className="text-sm text-zinc-200">{f.title}</span>
                  </div>
                  <div className="text-xs text-zinc-500 space-y-0.5 ml-4">
                    {f.file && <div>File: {f.file}{f.line ? `:${f.line}` : ""}</div>}
                    <div>{f.description}</div>
                    <div className="text-zinc-600">Recommendation: {f.recommendation}</div>
                    {f.category && <div className="text-zinc-700">Category: {f.category}</div>}
                    {f.effort && <div className="text-zinc-700">Effort: {f.effort}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "raw" && (
            <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(audit.document, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
