import { useCallback, useEffect, useState } from "react";
import { X, Settings } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import {
  getResolvedPerms,
  getSessionPerms,
  putSessionPerms,
  type PermissionMode,
} from "../../lib/api";
import { PermModeSelect } from "../settings/PermModeSelect";

interface SessionConfigModalProps {
  sessionId: string;
  onClose: () => void;
}

export function SessionConfigModal({
  sessionId,
  onClose,
}: SessionConfigModalProps) {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

  // --- Permissions state ---
  const [resolved, setResolved] = useState<Record<string, { mode: PermissionMode; source: string }>>({});
  const [sessionTools, setSessionTools] = useState<Record<string, PermissionMode>>({});
  const [permsLoading, setPermsLoading] = useState(false);
  const [permsError, setPermsError] = useState<string | null>(null);

  useEffect(() => {
    setPermsLoading(true);
    setPermsError(null);
    Promise.all([getResolvedPerms(sessionId), getSessionPerms(sessionId)])
      .then(([r, s]) => {
        setResolved(r.tools);
        setSessionTools({ ...s.tools });
      })
      .catch((e) => setPermsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPermsLoading(false));
  }, [sessionId]);

  const setSessionMode = async (name: string, mode: PermissionMode | "") => {
    const next = { ...sessionTools };
    if (!mode) delete next[name];
    else next[name] = mode;
    try {
      await putSessionPerms(sessionId, next);
      setSessionTools(next);
      const r = await getResolvedPerms(sessionId);
      setResolved(r.tools);
    } catch (e) {
      setPermsError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearAll = async () => {
    try {
      await putSessionPerms(sessionId, {});
      setSessionTools({});
      const r = await getResolvedPerms(sessionId);
      setResolved(r.tools);
    } catch (e) {
      setPermsError(e instanceof Error ? e.message : String(e));
    }
  };

  const overrideCount = Object.keys(sessionTools).length;
  const names = Object.keys(resolved).sort();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-800 rounded-lg w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-zinc-800">
          <Settings size={14} className="text-zinc-400" />
          <span className="text-xs font-medium text-zinc-300 ml-1">Session Config</span>
          <button
            onClick={onClose}
            type="button"
            className="ml-auto text-zinc-400 hover:text-zinc-200 p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200">
                Session overrides{overrideCount > 0 ? ` (${overrideCount})` : ""}
              </span>
            </div>
            {permsLoading && <p className="text-xs text-zinc-500">Loading…</p>}
            {permsError && <p className="text-xs text-red-400">{permsError}</p>}
            <div className="space-y-1">
              {names.map((name) => {
                const r = resolved[name];
                return (
                  <div
                    key={name}
                    className="flex items-center gap-2 py-1 border-b border-zinc-800/80 text-xs"
                  >
                    <span className="font-mono text-zinc-300 flex-1 min-w-0 truncate">{name}</span>
                    <span className="text-[10px] text-zinc-500 w-16 shrink-0">{r?.source}</span>
                    <span className="text-zinc-400 w-10 shrink-0">{r?.mode}</span>
                    <PermModeSelect
                      allowEmpty
                      emptyLabel="—"
                      value={sessionTools[name] ?? ""}
                      onChange={(mode) => void setSessionMode(name, mode)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                onClick={() => void clearAll()}
              >
                Clear session overrides
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
