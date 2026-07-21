import { useCallback, useEffect, useState } from "react";
import {
  getGlobalPerms,
  putGlobalPerms,
  resetGlobalPerms,
  type PermissionMode,
} from "../../lib/api";
import { PermModeSelect } from "./PermModeSelect";

export function GlobalPermsEditor() {
  const [tools, setTools] = useState<Record<string, PermissionMode>>({});
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getGlobalPerms();
      setTools({ ...res.tools });
      setPath(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await putGlobalPerms(tools);
      setTools({ ...res.tools });
      setMsg("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset global permissions to defaults? Your global edits will be lost.")) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const res = await resetGlobalPerms();
      setTools({ ...res.tools });
      setMsg("Reset to defaults");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading global permissions…</p>;
  }

  const names = Object.keys(tools)
    .filter((n) => n !== "external_directory" && !n.startsWith("external_directory:"))
    .sort();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-100">Global permissions</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Defaults for all sessions. Workspace and session can override.
        </p>
        {path && (
          <p className="text-[10px] text-zinc-600 mt-1 font-mono break-all">{path}</p>
        )}
      </div>

      <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
        {names.map((name) => (
          <div
            key={name}
            className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-800/80"
          >
            <span className="font-mono text-xs text-zinc-300">{name}</span>
            <PermModeSelect
              value={tools[name] ?? "ask"}
              onChange={(mode) => {
                if (!mode) return;
                setTools((t) => ({ ...t, [name]: mode }));
              }}
            />
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {msg && <p className="text-xs text-green-400">{msg}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="px-3 py-1.5 rounded bg-zinc-100 text-zinc-900 text-xs font-medium hover:bg-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void reset()}
          className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
