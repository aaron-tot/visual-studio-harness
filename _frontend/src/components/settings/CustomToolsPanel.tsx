import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Pencil, Trash2, Globe, FolderOpen, Layers } from "lucide-react";
import type { CustomTool } from "../../lib/api";
import {
  getCustomTools,
  deleteCustomTool,
  toggleCustomTool,
  getGlobalPerms,
  putGlobalPerms,
  getWorkspacePerms,
  putWorkspacePerms,
  getSessionPerms,
  putSessionPerms,
  getSession,
  resetGlobalPerms,
  type PermissionMode,
} from "../../lib/api";
import { PermModeSelect } from "./PermModeSelect";
import { CustomToolModal } from "./CustomToolModal";

type PermLayer = "global" | "workspace" | "session";

function useCustomPerms(layer: PermLayer, sessionId: string, workspaceRoot: string) {
  const [perms, setPerms] = useState<Record<string, PermissionMode>>({});
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (l: PermLayer) => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (l === "global") res = await getGlobalPerms();
      else if (l === "workspace" && workspaceRoot) res = await getWorkspacePerms(workspaceRoot);
      else if (l === "session" && sessionId) res = await getSessionPerms(sessionId);
      if (res) { setPerms({ ...res.tools }); setPath(res.path); }
    } catch (e) {
      setPerms({}); setPath("");
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [sessionId, workspaceRoot]);

  const save = useCallback(async (next: Record<string, PermissionMode>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      setPerms(next);
      let res;
      if (layer === "global") res = await putGlobalPerms(next);
      else if (layer === "workspace" && workspaceRoot) res = await putWorkspacePerms(workspaceRoot, next);
      else if (layer === "session" && sessionId) res = await putSessionPerms(sessionId, next);
      if (res) setPerms({ ...res.tools });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { savingRef.current = false; }
  }, [layer, sessionId, workspaceRoot]);

  const clear = useCallback(async () => {
    if (layer === "global") return;
    if (layer === "workspace" && workspaceRoot) await putWorkspacePerms(workspaceRoot, {});
    else if (layer === "session" && sessionId) await putSessionPerms(sessionId, {});
  }, [layer, sessionId, workspaceRoot]);

  return { perms, path, loading, error, load, save, clear, savingRef };
}

interface Props {
  sessionId: string;
}

export function CustomToolsPanel({ sessionId }: Props) {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create"; tool?: undefined } | { mode: "edit"; tool: CustomTool } | null>(null);
  const hasSession = !!sessionId;
  const [layer, setLayer] = useState<PermLayer>("global");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const cp = useCustomPerms(layer, sessionId, workspaceRoot);

  const loadTools = async () => {
    try {
      setLoading(true);
      const res = await getCustomTools();
      setTools(res.tools);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { void loadTools(); }, []);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((s) => setWorkspaceRoot(s.workspaceRoot || "")).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!loading) void cp.load(layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, layer]);

  const switchLayer = (l: PermLayer) => { setLayer(l); setMsg(null); };

  const onChangePerm = (name: string, mode: PermissionMode) => {
    if (!mode || cp.savingRef.current) return;
    void cp.save({ ...cp.perms, [name]: mode });
  };

  const onInherit = (name: string) => {
    if (cp.savingRef.current) return;
    const next = { ...cp.perms };
    delete next[name];
    void cp.save(next);
  };

  const onReset = async () => {
    if (layer === "global") {
      if (!confirm("Reset global permissions to defaults?")) return;
      await resetGlobalPerms();
      await cp.load("global");
      setMsg("Reset to defaults");
    } else {
      await cp.clear();
      await cp.load(layer);
      setMsg(`Cleared ${layer} perms`);
    }
  };

  const handleToggle = async (name: string) => {
    try { await toggleCustomTool(name); await loadTools(); } catch { /* ignore */ }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete custom tool "${name}"?`)) return;
    try { await deleteCustomTool(name); await loadTools(); } catch { /* ignore */ }
  };

  const isLayer = layer !== "global";

  return (
    <div className="min-h-0 flex flex-col p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-zinc-100">Custom Tools</h2>
            <button
              onClick={() => setModal({ mode: "create" })}
              className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <Plus className="h-3.5 w-3.5" />
              New Tool
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {tools.length} custom tool{tools.length !== 1 ? "s" : ""}.
          </p>
          {cp.path && (
            <p className="text-[10px] text-zinc-600 mt-1 font-mono break-all truncate">{cp.path}</p>
          )}
        </div>
        <div className="flex gap-0.5 items-center justify-center shrink-0">
          {([["global", "Global", Globe], ["workspace", "Workspace", FolderOpen], ["session", "Session", Layers]] as const).map(([key, label, Icon]) => {
            const disabled = !hasSession && key !== "global";
            return (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                disabled={disabled}
                className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
                  disabled
                    ? "text-zinc-700 cursor-not-allowed"
                    : layer === key
                      ? "bg-zinc-700 text-zinc-200"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
                onClick={() => !disabled && switchLayer(key as PermLayer)}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      {cp.error && <p className="text-xs text-red-400 mb-2">{cp.error}</p>}
      {msg && <p className="text-xs text-green-400 mb-2">{msg}</p>}

      {loading ? (
        <p className="text-xs text-zinc-500">Loading...</p>
      ) : tools.length === 0 ? (
        <p className="text-xs text-zinc-500">No custom tools yet. Create one to get started.</p>
      ) : (
        <div className="flex-1 space-y-2">
          {tools.map((t) => {
            const hasPerm = t.name in cp.perms;
            return (
              <div key={t.name} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-200">{t.name}</span>
                    {t.enabled ? (
                      <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-[10px] text-green-400">enabled</span>
                    ) : (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">disabled</span>
                    )}
                  </div>
                  {t.description && (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">{t.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <PermModeSelect
                    allowEmpty={isLayer}
                    emptyLabel="inherit"
                    value={isLayer && !hasPerm ? "" : (cp.perms[t.name] ?? "ask")}
                    onChange={(mode) => {
                      if (isLayer && !mode) { onInherit(t.name); return; }
                      if (mode) onChangePerm(t.name, mode);
                    }}
                  />
                  <button
                    onClick={() => void handleToggle(t.name)}
                    className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                    title={t.enabled ? "Disable" : "Enable"}
                  >
                    {t.enabled
                      ? <span className="h-3.5 w-3.5 flex items-center justify-center text-[10px] text-green-500">&#x2713;</span>
                      : <span className="h-3.5 w-3.5 flex items-center justify-center text-[10px]">&#x2715;</span>}
                  </button>
                  <button
                    onClick={() => setModal({ mode: "edit", tool: t })}
                    className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(t.name)}
                    className="rounded p-1 text-zinc-500 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800">
        <button
          type="button"
          onClick={() => void onReset()}
          className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
        >
          {layer === "global" ? "Reset global perms" : `Clear ${layer} perms`}
        </button>
      </div>

      {modal && (
        <CustomToolModal
          mode={modal.mode}
          tool={modal.tool}
          onClose={() => setModal(null)}
          onSaved={() => { void loadTools(); setModal(null); }}
        />
      )}
    </div>
  );
}
