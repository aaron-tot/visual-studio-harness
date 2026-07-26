import { useState, useEffect, useCallback, useMemo } from "react";
import { getGraphFiles, getGraphImports, getGraphExports } from "../../../../lib/api";
import type { GraphFileRecord, GraphImportRecord, GraphExportRecord } from "../../../../lib/api";
import { useChatStore } from "../../../../stores/chat";
import { EmptyState } from "../ui";
import { ViewToggle, RawPanel } from "./view-toggle";
import type { ViewMode } from "./view-toggle";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatAgentFiles(files: GraphFileRecord[]): string {
  if (files.length === 0) return "No indexed files found";
  const lines = files.map(
    (f) => `${f.path} [${f.language}] ${f.size}B modified=${new Date(f.modifiedMs).toISOString()}`
  );
  return `${files.length} files:\n${lines.join("\n")}`;
}

function FileDetail({ file, onClose, workspaceRoot }: { file: GraphFileRecord; onClose: () => void; workspaceRoot?: string }) {
  const [imports, setImports] = useState<GraphImportRecord[]>([]);
  const [exports, setExports] = useState<GraphExportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getGraphImports(file.path, workspaceRoot), getGraphExports(file.path, workspaceRoot)])
      .then(([imp, exp]) => { setImports(imp); setExports(exp); })
      .finally(() => setLoading(false));
  }, [file.path, workspaceRoot]);

  return (
    <div className="border-t border-zinc-800/50 px-3 py-2 space-y-2 bg-zinc-900/30">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 font-mono truncate">{file.path}</span>
        <button onClick={onClose} className="text-[9px] text-zinc-500 hover:text-zinc-300">✕</button>
      </div>
      {loading ? (
        <div className="text-[9px] text-zinc-600">Loading…</div>
      ) : (
        <>
          {imports.length > 0 && (
            <div>
              <div className="text-[9px] text-zinc-500 mb-0.5">Imports ({imports.length})</div>
              {imports.map((imp, i) => (
                <div key={i} className="text-[10px] text-zinc-400 font-mono pl-2">
                  {imp.importType}: {imp.module} {imp.symbols.length ? `{${imp.symbols.join(", ")}}` : ""}
                </div>
              ))}
            </div>
          )}
          {exports.length > 0 && (
            <div>
              <div className="text-[9px] text-zinc-500 mb-0.5">Exports ({exports.length})</div>
              {exports.map((exp, i) => (
                <div key={i} className="text-[10px] text-zinc-400 font-mono pl-2">
                  {exp.isDefault ? "default " : ""}{exp.symbol}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FilesView() {
  const [files, setFiles] = useState<GraphFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphFileRecord | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("pretty");
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

  useEffect(() => {
    getGraphFiles(undefined, workspaceRoot || undefined)
      .then((r) => { setFiles(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed"); setLoading(false); });
  }, [workspaceRoot]);

  const rawText = useMemo(() => formatAgentFiles(files), [files]);

  if (loading) return <EmptyState>Loading files…</EmptyState>;
  if (error) return <EmptyState><span className="text-red-400">Error: {error}</span></EmptyState>;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ViewToggle mode={viewMode} onChange={setViewMode} />
      {viewMode === "pretty" ? (
        <>
          <div className="flex items-center justify-end px-3 py-1 border-b border-zinc-800/50">
            <span className="text-[9px] text-zinc-500">{files.length} files indexed</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {files.map((file) => (
              <div key={file.id}>
                <div
                  className={`flex items-center gap-2 px-3 py-1 cursor-default hover:bg-zinc-800/50 ${
                    selected?.id === file.id ? "bg-zinc-800/50" : ""
                  }`}
                  onClick={() => setSelected(selected?.id === file.id ? null : file)}
                >
                  <span className="text-[10px]">{file.language === "typescript" ? "\u{1F537}" : "\u{1F7E8}"}</span>
                  <span className="text-[11px] text-zinc-300 font-mono truncate flex-1">{file.path}</span>
                  <span className="text-[9px] text-zinc-600 shrink-0">{formatBytes(file.size)}</span>
                </div>
                {selected?.id === file.id && (
                  <FileDetail file={file} onClose={() => setSelected(null)} workspaceRoot={workspaceRoot || undefined} />
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <RawPanel text={rawText} />
      )}
    </div>
  );
}
