import { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, Pencil } from "lucide-react";
import type { AuditEntry, AuditDocument, AuditFinding } from "../../../../lib/api";

interface AuditJsonModalProps {
  audit: AuditEntry;
  onClose: () => void;
  onSave: (name: string, document: AuditDocument) => void;
}

const severityColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  info: "bg-zinc-500",
};

const severityTextColors: Record<string, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-blue-400",
  info: "text-zinc-400",
};

function severityOrd(s: string): number {
  if (s === "critical") return 0;
  if (s === "high") return 1;
  if (s === "medium") return 2;
  if (s === "low") return 3;
  return 4;
}

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

export function AuditJsonModal({ audit, onClose, onSave }: AuditJsonModalProps) {
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");
  const [editing, setEditing] = useState(false);
  const [editDoc, setEditDoc] = useState<AuditDocument>(() => structuredClone(audit.document));
  const [rawText, setRawText] = useState(() => JSON.stringify(audit.document, null, 2));
  const [rawParseError, setRawParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const doc = editing ? editDoc : audit.document;
  const m = doc.meta;
  const isImplCheck = m.auditType === "implementation_completed";

  const sortedFindings = useMemo(
    () => [...doc.findings].sort((a, b) => severityOrd(a.severity) - severityOrd(b.severity)),
    [doc.findings]
  );

  /* ── Raw text editor callbacks ── */
  const handleRawChange = useCallback((v: string) => {
    setRawText(v);
    try {
      const parsed = JSON.parse(v) as AuditDocument;
      setEditDoc(parsed);
      setRawParseError(null);
    } catch (e) {
      setRawParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, []);

  /* ── Pretty field changes ── */
  const handleMetaChange = useCallback((patch: Partial<AuditDocument["meta"]>) => {
    setEditDoc((prev) => ({ ...prev, meta: { ...prev.meta, ...patch } }));
  }, []);

  const handleFindingChange = useCallback((index: number, patch: Partial<AuditFinding>) => {
    setEditDoc((prev) => {
      const findings = prev.findings.map((f, i) => (i === index ? { ...f, ...patch } : f));
      return { ...prev, findings };
    });
  }, []);

  const handleDeleteFinding = useCallback((index: number) => {
    setEditDoc((prev) => ({
      ...prev,
      findings: prev.findings.filter((_, i) => i !== index),
    }));
  }, []);

  const handleAddFinding = useCallback(() => {
    setEditDoc((prev) => ({
      ...prev,
      findings: [
        ...prev.findings,
        {
          severity: "medium",
          title: "",
          description: "",
          recommendation: "",
          category: "",
          effort: "quick" as const,
        },
      ],
    }));
  }, []);

  /* ── Start / Cancel / Save ── */
  const handleStartEdit = useCallback(() => {
    setEditDoc(structuredClone(audit.document));
    setRawText(JSON.stringify(audit.document, null, 2));
    setRawParseError(null);
    setEditing(true);
  }, [audit.document]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setEditDoc(structuredClone(audit.document));
    setRawText(JSON.stringify(audit.document, null, 2));
    setRawParseError(null);
  }, [audit.document]);

  const handleSave = useCallback(() => {
    if (viewMode === "raw" && rawParseError) return;
    const toSave = viewMode === "raw" ? editDoc : editDoc;
    onSave(audit.name, toSave);
    setSaving(true);
    setEditing(false);
  }, [viewMode, rawParseError, editDoc, audit.name, onSave]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(audit.document, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [audit.document]);

  const hasAttachments = m.attachments && m.attachments.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-y-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-zinc-200">{m.title}</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase">
              {m.auditType}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Pretty/Raw toggle */}
            <div className="flex bg-zinc-800 rounded text-xs">
              <button
                type="button"
                className={`px-2 py-0.5 rounded-l transition-colors ${viewMode === "pretty" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                onClick={() => { setViewMode("pretty"); }}
              >
                Pretty
              </button>
              <button
                type="button"
                className={`px-2 py-0.5 rounded-r transition-colors ${viewMode === "raw" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                onClick={() => { setViewMode("raw"); }}
              >
                Raw
              </button>
            </div>

            {/* Edit / Save / Cancel */}
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={saving}
                  className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={handleCancelEdit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || (viewMode === "raw" && !!rawParseError)}
                  className="text-[11px] px-2 py-0.5 rounded bg-emerald-700 text-emerald-200 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
                onClick={handleStartEdit}
              >
                <Pencil size={10} />
                Edit
              </button>
            )}

            {/* Copy */}
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>

            <button type="button" className="text-zinc-500 hover:text-zinc-300 transition-colors" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {viewMode === "raw" ? (
            /* Raw JSON view / editor */
            editing ? (
              <div className="h-full flex flex-col">
                {rawParseError && (
                  <div className="text-xs text-red-400 bg-red-950/50 rounded px-2 py-1 mb-2 font-mono">
                    {rawParseError}
                  </div>
                )}
                <textarea
                  className="flex-1 w-full bg-zinc-950 border border-zinc-800 rounded text-xs font-mono text-zinc-400 p-3 resize-none outline-none focus:border-blue-700"
                  value={rawText}
                  onChange={(e) => handleRawChange(e.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="relative">
                <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {JSON.stringify(audit.document, null, 2)}
                </pre>
              </div>
            )
          ) : editing ? (
            /* Pretty Edit View */
            <PrettyEditView
              doc={editDoc}
              onMetaChange={handleMetaChange}
              onFindingChange={handleFindingChange}
              onDeleteFinding={handleDeleteFinding}
              onAddFinding={handleAddFinding}
            />
          ) : (
            /* Pretty Read View */
            <PrettyReadView doc={audit.document} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════
 * PRETTY READ VIEW (read-only structured display)
 * ══════════════════════════════════════════════ */
function PrettyReadView({ doc }: { doc: AuditDocument }) {
  const m = doc.meta;
  const sortedFindings = useMemo(
    () => [...doc.findings].sort((a, b) => severityOrd(a.severity) - severityOrd(b.severity)),
    [doc.findings]
  );
  return (
    <div className="space-y-5">
      {/* Summary */}
      <Section title="Summary">
        <p className="text-sm text-zinc-300 leading-relaxed">{m.summary}</p>
      </Section>

      {/* Severity counts */}
      {(m.criticalCount || m.highCount || m.mediumCount || m.lowCount || m.infoCount) ? (
        <Section title="Findings">
          <div className="flex gap-3 flex-wrap">
            {(["critical", "high", "medium", "low", "info"] as const).map((s) => {
              const count = m[`${s}Count` as keyof typeof m] as number;
              if (!count) return null;
              return (
                <div key={s} className="flex items-center gap-1.5 text-xs">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${severityColors[s]}`} />
                  <span className="text-zinc-400">{count} {s}</span>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* Overall status */}
      {m.overallStatus && (
        <Section title="Overall Status">
          <div className={`text-sm font-semibold ${statusColor(m.overallStatus)}`}>
            {m.overallStatus.toUpperCase()}
          </div>
          {m.overallAssessment && (
            <p className="text-sm text-zinc-400 mt-1">{m.overallAssessment}</p>
          )}
        </Section>
      )}

      {/* Assessments */}
      {m.assessments && m.assessments.length > 0 && (
        <Section title="Per-Aspect Assessments">
          <div className="space-y-1.5">
            {m.assessments.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-sm border border-zinc-800 rounded px-3 py-2">
                <span className="shrink-0 mt-0.5">{assessmentIcon(a.status)}</span>
                <div>
                  <div className="text-zinc-300 font-medium">{a.aspectName}</div>
                  {a.expectedBehavior && <div className="text-[11px] text-zinc-600">Expected: {a.expectedBehavior}</div>}
                  {a.actualImplementation && <div className="text-[11px] text-zinc-600">Actual: {a.actualImplementation}</div>}
                  {a.fileReferences && a.fileReferences.length > 0 && (
                    <div className="text-[10px] text-zinc-700 mt-0.5">Files: {a.fileReferences.join(", ")}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* End goal */}
      {m.endGoal && (
        <Section title="End Goal">
          <p className="text-sm text-zinc-400 border-l-2 border-zinc-700 pl-3">{m.endGoal}</p>
        </Section>
      )}

      {/* Attachments */}
      {m.attachments && m.attachments.length > 0 && (
        <Section title="Attachments">
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((att, i) => (
              <div key={i} className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                {att.label || att.designName || "attached"}
                {att.specName && <span className="text-zinc-600"> / {att.specName}</span>}
                {att.planName && <span className="text-zinc-600"> / {att.planName}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Findings list */}
      {sortedFindings.length > 0 && (
        <Section title={`Findings (${sortedFindings.length})`}>
          <div className="space-y-2">
            {sortedFindings.map((f, i) => (
              <div key={i} className="border border-zinc-800 rounded px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-block w-2 h-2 rounded-full ${severityColors[f.severity]}`} />
                  <span className={`text-xs font-semibold ${severityTextColors[f.severity]}`}>{f.severity.toUpperCase()}</span>
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
        </Section>
      )}

      {/* Metadata */}
      <Section title="Metadata">
        <div className="text-xs text-zinc-600 grid grid-cols-2 gap-x-4 gap-y-1">
          <div>Scope: {m.scope}</div>
          <div>Created: {m.createdAt}</div>
          <div>By: {m.createdBy}</div>
          {m.providerName && <div>Provider: {m.providerName}</div>}
          {m.agentModel && <div>Agent: {m.agentModel}</div>}
          {m.workspaceRoot && <div>Workspace: {m.workspaceRoot}</div>}
          {m.sessionId && <div>Session: {m.sessionId}</div>}
        </div>
      </Section>

      {/* rawReport */}
      {m.rawReport && (
        <Section title="Raw Report">
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-words leading-relaxed font-mono">
            {m.rawReport}
          </pre>
        </Section>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
 * PRETTY EDIT VIEW (inline form fields)
 * ══════════════════════════════════════════════ */
function PrettyEditView({
  doc,
  onMetaChange,
  onFindingChange,
  onDeleteFinding,
  onAddFinding,
}: {
  doc: AuditDocument;
  onMetaChange: (patch: Partial<AuditDocument["meta"]>) => void;
  onFindingChange: (index: number, patch: Partial<AuditFinding>) => void;
  onDeleteFinding: (index: number) => void;
  onAddFinding: () => void;
}) {
  const m = doc.meta;
  const totalFindings = doc.findings.length;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of doc.findings) {
    if (f.severity in counts) (counts as Record<string, number>)[f.severity]++;
  }

  return (
    <div className="space-y-5">
      {/* Title / Summary */}
      <Section title="Meta">
        <div className="space-y-2">
          <Field label="Title">
            <input
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
              value={m.title}
              onChange={(e) => onMetaChange({ title: e.target.value })}
            />
          </Field>
          <Field label="Summary">
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 resize-none"
              rows={3}
              value={m.summary}
              onChange={(e) => onMetaChange({ summary: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Audit Type">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                value={m.auditType}
                onChange={(e) => onMetaChange({ auditType: e.target.value })}
              />
            </Field>
            <Field label="Created At">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 font-mono"
                value={m.createdAt}
                onChange={(e) => onMetaChange({ createdAt: e.target.value })}
              />
            </Field>
            <Field label="Created By">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                value={m.createdBy}
                onChange={(e) => onMetaChange({ createdBy: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="End Goal">
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 resize-none"
                rows={2}
                value={m.endGoal || ""}
                onChange={(e) => onMetaChange({ endGoal: e.target.value || undefined })}
              />
            </Field>
            <Field label="Overall Assessment">
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 resize-none"
                rows={2}
                value={m.overallAssessment || ""}
                onChange={(e) => onMetaChange({ overallAssessment: e.target.value || undefined })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Overall Status">
              <select
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                value={m.overallStatus || ""}
                onChange={(e) => onMetaChange({ overallStatus: (e.target.value || undefined) as "pass" | "partial" | "fail" | undefined })}
              >
                <option value="">— none —</option>
                <option value="pass">pass</option>
                <option value="partial">partial</option>
                <option value="fail">fail</option>
              </select>
            </Field>
            <Field label="Scope">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                value={m.scope}
                onChange={(e) => onMetaChange({ scope: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Provider">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200"
                value={m.providerName || ""}
                onChange={(e) => onMetaChange({ providerName: e.target.value || undefined })}
              />
            </Field>
            <Field label="Agent Model">
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 font-mono"
                value={m.agentModel || ""}
                onChange={(e) => onMetaChange({ agentModel: e.target.value || undefined })}
              />
            </Field>
            <Field label="Raw Report">
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 resize-none font-mono"
                rows={2}
                value={m.rawReport || ""}
                onChange={(e) => onMetaChange({ rawReport: e.target.value || undefined })}
              />
            </Field>
          </div>
        </div>
      </Section>

      {/* Findings */}
      <Section title={`Findings (${totalFindings}) — severity counts will auto-update`}>
        <div className="space-y-2">
          {doc.findings.map((f, i) => (
            <div key={i} className="border border-zinc-800 rounded px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600 font-mono">#{i + 1}</span>
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-950 text-red-400 hover:bg-red-900 transition-colors"
                  onClick={() => onDeleteFinding(i)}
                >
                  Remove
                </button>
              </div>

              {/* Severity + Title row */}
              <div className="flex gap-2">
                <select
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-300 w-24"
                  value={f.severity}
                  onChange={(e) => onFindingChange(i, { severity: e.target.value as AuditFinding["severity"] })}
                >
                  <option value="critical">critical</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                  <option value="info">info</option>
                </select>
                <input
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-sm text-zinc-200"
                  placeholder="Title"
                  value={f.title}
                  onChange={(e) => onFindingChange(i, { title: e.target.value })}
                />
              </div>

              {/* File + Line */}
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 font-mono"
                  placeholder="File path (optional)"
                  value={f.file || ""}
                  onChange={(e) => onFindingChange(i, { file: e.target.value || undefined })}
                />
                <input
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 font-mono"
                  placeholder="Line"
                  type="number"
                  value={f.line ?? ""}
                  onChange={(e) => onFindingChange(i, { line: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>

              {/* Description */}
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 resize-none"
                rows={2}
                placeholder="Description"
                value={f.description}
                onChange={(e) => onFindingChange(i, { description: e.target.value })}
              />

              {/* Recommendation */}
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 resize-none"
                rows={1}
                placeholder="Recommendation"
                value={f.recommendation}
                onChange={(e) => onFindingChange(i, { recommendation: e.target.value })}
              />

              {/* Category + Effort */}
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300"
                  placeholder="Category (e.g. memory_leak, missing_implementation)"
                  value={f.category || ""}
                  onChange={(e) => onFindingChange(i, { category: e.target.value || undefined })}
                />
                <select
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-300 w-28"
                  value={f.effort || ""}
                  onChange={(e) => onFindingChange(i, { effort: (e.target.value || undefined) as "quick" | "moderate" | "significant" | undefined })}
                >
                  <option value="">effort —</option>
                  <option value="quick">quick</option>
                  <option value="moderate">moderate</option>
                  <option value="significant">significant</option>
                </select>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            onClick={onAddFinding}
          >
            + Add Finding
          </button>
        </div>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════
 * HELPERS
 * ══════════════════════════════════════════════ */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-zinc-600 uppercase tracking-wider block mb-0.5">{label}</span>
      {children}
    </label>
  );
}
