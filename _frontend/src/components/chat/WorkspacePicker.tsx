import { useEffect, useState } from "react";
import { FolderOpen, ChevronUp, Check, X } from "lucide-react";
import { listFs, listWorkspaces, type FsListResult } from "../../lib/api";
import { useChatStore } from "../../stores/chat";

interface WorkspacePickerProps {
  /** open menu below (centered empty state) vs above (bottom bar) */
  menuPlacement?: "up" | "down";
  className?: string;
}

export function WorkspacePicker({ menuPlacement = "up", className = "" }: WorkspacePickerProps) {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const sessionId = useChatStore((s) => s.sessionId);
  const setWorkspaceRoot = useChatStore((s) => s.setWorkspaceRoot);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [fs, setFs] = useState<FsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const locked = Boolean(sessionId);

  const refreshRecent = async () => {
    try {
      const r = await listWorkspaces();
      setRecent(r.workspaces || []);
    } catch {
      setRecent([]);
    }
  };

  useEffect(() => {
    refreshRecent();
  }, [sessionId, workspaceRoot]);

  const applyWorkspace = async (path: string) => {
    if (locked) {
      setError("Workspace is fixed for this session");
      return;
    }
    setWorkspaceRoot(path);
    setError("");
    setOpen(false);
    setBrowse(false);
    refreshRecent();
  };

  const openBrowser = async (path?: string) => {
    setBrowse(true);
    setLoading(true);
    setError("");
    try {
      const res = await listFs(path || workspaceRoot || undefined);
      if (res.error && !res.entries?.length) setError(res.error);
      setFs(res);
    } catch {
      setError("Failed to list folder");
    }
    setLoading(false);
  };

  const short = (p: string) => {
    if (p.length <= 48) return p;
    return "…" + p.slice(-46);
  };

  const menuPos =
    menuPlacement === "down"
      ? "top-full left-0 mt-1"
      : "bottom-full left-0 mb-1";

  // Existing session: read-only path, no picker UI clutter
  if (locked) {
    return (
      <div
        className={`flex items-center gap-1.5 min-w-0 max-w-[360px] text-xs text-zinc-500 ${className}`}
        title={workspaceRoot}
      >
        <FolderOpen size={12} className="shrink-0" />
        <span className="truncate font-mono">{workspaceRoot ? short(workspaceRoot) : "—"}</span>
      </div>
    );
  }

  return (
    <div className={`relative flex items-center gap-2 min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) refreshRecent();
        }}
        className="flex items-center gap-1.5 min-w-0 max-w-[360px] text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-zinc-300 hover:border-zinc-500"
        title={workspaceRoot || "Select workspace"}
      >
        <FolderOpen size={12} className="shrink-0 text-zinc-500" />
        <span className="truncate font-mono">
          {workspaceRoot ? short(workspaceRoot) : "Select workspace folder…"}
        </span>
      </button>

      {open && !browse && (
        <div
          className={`absolute ${menuPos} z-50 w-80 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl`}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400">Workspace</span>
            <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          </div>
          <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-wide text-zinc-600 px-1">Recent sessions</p>
            {recent.length === 0 && (
              <p className="text-xs text-zinc-600 px-1 py-2">No recent workspaces yet</p>
            )}
            {recent.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => applyWorkspace(w)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-zinc-800 font-mono truncate ${
                  w === workspaceRoot ? "text-green-400 bg-zinc-800/80" : "text-zinc-300"
                }`}
                title={w}
              >
                {w === workspaceRoot && <Check size={10} className="inline mr-1" />}
                {w}
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={() => openBrowser()}
              className="w-full text-xs px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              Browse folders…
            </button>
          </div>
          {error && <p className="text-xs text-red-400 px-3 pb-2">{error}</p>}
        </div>
      )}

      {open && browse && (
        <div
          className={`absolute ${menuPos} z-50 w-96 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl`}
        >
          <div className="flex items-center gap-2 px-2 py-2 border-b border-zinc-800">
            <button
              type="button"
              disabled={!fs?.parent}
              onClick={() => fs?.parent && openBrowser(fs.parent)}
              className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30"
              title="Up"
            >
              <ChevronUp size={14} />
            </button>
            <span className="flex-1 text-[11px] font-mono text-zinc-400 truncate" title={fs?.path}>
              {fs?.path || "…"}
            </span>
            <button type="button" onClick={() => setBrowse(false)} className="text-zinc-500 hover:text-zinc-300 text-xs px-1">
              Back
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {loading && <p className="text-xs text-zinc-500 p-2">Loading…</p>}
            {!loading &&
              fs?.entries
                ?.filter((e) => e.isDir)
                .map((e) => (
                  <button
                    key={e.path}
                    type="button"
                    onClick={() => openBrowser(e.path)}
                    onDoubleClick={() => applyWorkspace(e.path)}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded hover:bg-zinc-800 text-zinc-300"
                  >
                    <FolderOpen size={12} className="text-amber-600/80 shrink-0" />
                    <span className="truncate">{e.name}</span>
                  </button>
                ))}
            {!loading && fs?.entries?.filter((e) => e.isDir).length === 0 && (
              <p className="text-xs text-zinc-600 p-2">No subfolders</p>
            )}
          </div>
          <div className="p-2 border-t border-zinc-800 flex gap-2">
            <button
              type="button"
              disabled={!fs?.path}
              onClick={() => fs?.path && applyWorkspace(fs.path)}
              className="flex-1 text-xs px-2 py-1.5 rounded bg-green-800/80 hover:bg-green-700 text-white disabled:opacity-40"
            >
              Use this folder
            </button>
          </div>
          {error && <p className="text-xs text-red-400 px-3 pb-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
