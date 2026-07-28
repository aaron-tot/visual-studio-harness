import { useState, useEffect, useMemo } from "react";
import { getGraphFiles, getGraphImports, getGraphExports } from "../../../../lib/api";
import type { GraphFileRecord, GraphImportRecord, GraphExportRecord } from "../../../../lib/api";
import { EmptyState, PanelInput } from "../ui";
import { ViewToggle, RawPanel } from "./view-toggle";
import type { ViewMode } from "./view-toggle";
import { useCurrentWorkspaceRoot } from "../../../../hooks/useCurrentWorkspaceRoot";

function formatAgentDeps(imports: GraphImportRecord[], exports: GraphExportRecord[], filePath: string): string {
  const parts: string[] = [`File: ${filePath}`];
  if (imports.length > 0) {
    parts.push(`Imports (${imports.length}):`);
    parts.push(...imports.map(
      (imp) => `  ${imp.importType} ${imp.module}${imp.symbols.length ? ` {${imp.symbols.join(", ")}}` : ""}`
    ));
  } else {
    parts.push("Imports: none");
  }
  if (exports.length > 0) {
    parts.push(`Exports (${exports.length}):`);
    parts.push(...exports.map(
      (exp) => `  ${exp.isDefault ? "default " : ""}${exp.symbol}`
    ));
  } else {
    parts.push("Exports: none");
  }
  return parts.join("\n");
}

export function DepsView() {
  const [files, setFiles] = useState<GraphFileRecord[]>([]);
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [imports, setImports] = useState<GraphImportRecord[]>([]);
  const [exports, setExports] = useState<GraphExportRecord[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("pretty");
  const workspaceRoot = useCurrentWorkspaceRoot();

  useEffect(() => {
    getGraphFiles(undefined, workspaceRoot).then(setFiles).catch(() => {});
  }, [workspaceRoot]);

  const filtered = useMemo(() => {
    if (!search) return files.slice(0, 50);
    const q = search.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 50);
  }, [files, search]);

  useEffect(() => {
    if (!selectedFile) { setImports([]); setExports([]); return; }
    setLoadingDeps(true);
    Promise.all([getGraphImports(selectedFile, workspaceRoot), getGraphExports(selectedFile, workspaceRoot)])
      .then(([imp, exp]) => { setImports(imp); setExports(exp); })
      .finally(() => setLoadingDeps(false));
  }, [selectedFile, workspaceRoot]);

  const rawText = useMemo(
    () => selectedFile ? formatAgentDeps(imports, exports, selectedFile) : "Select a file to view dependencies",
    [imports, exports, selectedFile]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ViewToggle mode={viewMode} onChange={setViewMode} />
      {viewMode === "pretty" ? (
        <>
          <div className="px-2 py-1 border-b border-zinc-800/50">
            <PanelInput
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-32 overflow-y-auto border-b border-zinc-800/50">
            {filtered.map((f) => (
              <div
                key={f.id}
                className={`px-3 py-0.5 text-[10px] font-mono cursor-default hover:bg-zinc-800/50 ${
                  selectedFile === f.path ? "bg-zinc-800/50 text-zinc-200" : "text-zinc-400"
                }`}
                onClick={() => setSelectedFile(selectedFile === f.path ? null : f.path)}
              >
                {f.path}
              </div>
            ))}
          </div>
          {selectedFile ? (
            <div className="flex-1 overflow-y-auto">
              {loadingDeps ? (
                <EmptyState>Loading dependencies…</EmptyState>
              ) : (
                <div className="grid grid-cols-2 gap-0 min-h-0">
                  <div className="border-r border-zinc-800/50 overflow-y-auto">
                    <div className="px-2 py-1 text-[9px] text-zinc-500 font-medium border-b border-zinc-800/50">
                      Imports ({imports.length})
                    </div>
                    {imports.length === 0 ? (
                      <div className="px-2 py-1 text-[9px] text-zinc-600">none</div>
                    ) : (
                      imports.map((imp, i) => (
                        <div key={i} className="px-2 py-0.5 text-[10px] text-zinc-400 font-mono">
                          <div className="text-zinc-300">{imp.module}</div>
                          <div className="text-zinc-500 text-[9px]">
                            {imp.importType} {imp.symbols.length ? `{${imp.symbols.join(", ")}}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="overflow-y-auto">
                    <div className="px-2 py-1 text-[9px] text-zinc-500 font-medium border-b border-zinc-800/50">
                      Exports ({exports.length})
                    </div>
                    {exports.length === 0 ? (
                      <div className="px-2 py-1 text-[9px] text-zinc-600">none</div>
                    ) : (
                      exports.map((exp, i) => (
                        <div key={i} className="px-2 py-0.5 text-[10px] text-zinc-400 font-mono">
                          {exp.isDefault ? "default " : ""}{exp.symbol}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState>Select a file to view dependencies</EmptyState>
          )}
        </>
      ) : (
        <RawPanel text={rawText} />
      )}
    </div>
  );
}
