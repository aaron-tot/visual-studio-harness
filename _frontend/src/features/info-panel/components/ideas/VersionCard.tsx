import { useCallback, useState } from "react";
import { Check, Pencil } from "lucide-react";
import type { SpecDocument, PlanDocument } from "../../../../lib/api";
import { updateDocViaApi } from "../../../../lib/api";
import type { DesignLocation } from "../../types";
import { scopeApiParams } from "../../lib/scope-params";
import { SpecPrettyView, PlanPrettyView } from "./DesignPrettyViews";
import { EditableSpecView, EditablePlanView } from "./DesignEditViews";

interface VersionCardProps {
  label: string;
  doc: SpecDocument | PlanDocument;
  version: number;
  docType: "spec" | "plan";
  planName: string;
  location?: DesignLocation;
  onRefresh?: () => void;
  onResult?: (msg: string) => void;
}

export function VersionCard({ label, doc, version, docType, planName, location, onRefresh, onResult }: VersionCardProps) {
  const [viewMode, setViewMode] = useState<"pretty" | "raw">("pretty");
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);

  const handleStartEdit = useCallback(() => {
    setEditFields({});
    setEditing(true);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditFields(null);
    setEditing(false);
  }, []);

  const handleFieldChange = useCallback((fields: Record<string, unknown>) => {
    setEditFields((prev) => ({ ...prev, ...fields }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!editFields || Object.keys(editFields).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateDocViaApi({
        name: planName,
        docType,
        version,
        fields: editFields,
        ...scopeApiParams(location || { scope: "global" }),
      });
      onResult?.(`${docType === "spec" ? "Spec" : "Plan"} v${version} saved`);
      setEditing(false);
      setEditFields(null);
      onRefresh?.();
    } catch (err) {
      onResult?.(`Error: ${err instanceof Error ? err.message : "save failed"}`);
    } finally {
      setSaving(false);
    }
  }, [editFields, planName, docType, version, location, onResult, onRefresh]);

  const mergedDoc = editing && editFields ? { ...doc, ...editFields } : doc;

  return (
    <div className="border border-zinc-800 rounded">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
        <span className="text-sm font-semibold text-zinc-300">{label}</span>
        <div className="flex items-center gap-2">
          {/* Pretty/Raw toggle */}
          <div className="flex bg-zinc-800 rounded text-xs">
            <button
              type="button"
              className={`px-2 py-0.5 rounded-l transition-colors ${viewMode === "pretty" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
              onClick={() => { setViewMode("pretty"); setEditing(false); setEditFields(null); }}
            >
              Pretty
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded-r transition-colors ${viewMode === "raw" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
              onClick={() => { setViewMode("raw"); setEditing(false); setEditFields(null); }}
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
                className="text-[11px] px-2 py-0.5 rounded bg-emerald-700 text-emerald-200 hover:bg-emerald-600 transition-colors flex items-center gap-1 disabled:opacity-50"
                onClick={handleSave}
              >
                <Check size={10} />
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={handleCancelEdit}
              >
                Cancel
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
        </div>
      </div>

      {/* Content */}
      <div className={viewMode === "raw" && !editing ? "p-3 bg-zinc-950" : "p-3"}>
        {editing ? (
          viewMode === "pretty" ? (
            docType === "spec" ? (
              <EditableSpecView spec={mergedDoc as SpecDocument} vNum={version} onChange={handleFieldChange} />
            ) : (
              <EditablePlanView plan={mergedDoc as PlanDocument} vNum={version} onChange={handleFieldChange} />
            )
          ) : (
            <RawJsonEditor doc={mergedDoc} onChange={handleFieldChange} />
          )
        ) : (
          viewMode === "pretty" ? (
            docType === "spec" ? (
              <SpecPrettyView spec={doc as SpecDocument} vNum={version} />
            ) : (
              <PlanPrettyView plan={doc as PlanDocument} vNum={version} />
            )
          ) : (
            <pre className="text-sm text-zinc-400 overflow-auto max-h-[60vh] leading-relaxed font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(doc, null, 2)}
            </pre>
          )
        )}
      </div>
    </div>
  );
}

/** Raw JSON editor as a single textarea */
function RawJsonEditor({
  doc,
  onChange,
}: {
  doc: SpecDocument | PlanDocument;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(doc, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = (v: string) => {
    setRaw(v);
    try {
      const parsed = JSON.parse(v);
      const { meta, ...fields } = parsed;
      onChange(fields);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div>
      {parseError && <div className="text-xs text-red-400 mb-1 font-mono">{parseError}</div>}
      <textarea
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-300 font-mono leading-relaxed focus:outline-none focus:border-blue-500 min-h-[40vh]"
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
