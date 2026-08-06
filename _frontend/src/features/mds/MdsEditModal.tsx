import { useEffect, useRef, useState } from "react";
import { readMdsScopeFile, writeMdsScopeFile } from "../../lib/api";
import type { PlanScope } from "../info-panel/types";
import { MdsJsonForm } from "./MdsJsonForm";

interface Props {
  scope: PlanScope;
  relPath: string;
  ext: string;
  sessionId?: string;
  workspaceRoot?: string;
  allTags: string[];
  onClose: () => void;
  onSaved: () => void;
}

/** Editor for an MDS scope file. JSON files get Fields | Raw tabs. */
export function MdsEditModal({ scope, relPath, ext, sessionId, workspaceRoot, allTags, onClose, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"fields" | "raw">(ext === "json" ? "fields" : "raw");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    readMdsScopeFile({ scope, path: relPath, sessionId, workspaceRoot })
      .then((r) => {
        if (!cancelled) {
          setContent(r);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope, relPath, sessionId, workspaceRoot]);

  useEffect(() => {
    if (!loading && view === "raw") areaRef.current?.focus();
  }, [loading, view]);

  const save = async () => {
    if (saving) return;
    if (ext === "json") {
      try {
        JSON.parse(content);
      } catch {
        setError("Invalid JSON — fix the syntax before saving.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await writeMdsScopeFile({ scope, path: relPath, content, sessionId, workspaceRoot });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-zinc-200">{relPath}</div>
            <div className="text-[10px] text-zinc-500">
              {scope} scope · .{ext || "no ext"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {ext === "json" && (
          <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5">
            <TabButton active={view === "fields"} onClick={() => setView("fields")}>
              Fields
            </TabButton>
            <TabButton active={view === "raw"} onClick={() => setView("raw")}>
              Raw
            </TabButton>
          </div>
        )}

        {error && (
          <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-1.5 text-[11px] text-red-400">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">Loading…</div>
          ) : ext === "json" && view === "fields" ? (
            <div className="h-full overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <MdsJsonForm raw={content} onRawChange={setContent} allTags={allTags} />
            </div>
          ) : (
            <textarea
              ref={areaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                  e.preventDefault();
                  void save();
                }
                if (e.key === "Escape") onClose();
              }}
              spellCheck={false}
              className="h-full w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none focus:border-zinc-600"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] ${
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
