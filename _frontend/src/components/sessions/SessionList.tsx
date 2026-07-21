import { useEffect, useMemo, useState, useCallback } from "react";
import { Archive, Info, CheckCircle2, Trash2 } from "lucide-react";
import { SortableTree } from "../../features/info-panel/components/testing/sortable-tree";
import { useSessionStore } from "../../features/sessions/store";
import type { TreeItems } from "../../features/info-panel/components/testing/sortable-tree/types";
import type { SessionMeta } from "../../../_shared/types";

interface SessionListProps {
  search: string;
}

function SessionActions({ id }: { id: string }) {
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const archive = useSessionStore((s) => s.archive);
  const rename = useSessionStore((s) => s.rename);
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const doneNotifications = useSessionStore((s) => s.doneNotifications);
  const sessions = useSessionStore((s) => s.sessions);
  const meta = sessions.find((s) => s.id === id);
  const streaming = !!streamingSessions[id];
  const done = !!doneNotifications[id];
  const active = activeId === id;
  const [showInfo, setShowInfo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(meta?.title || "");

  const handleRename = async () => {
    const trimmed = editValue.trim();
    if (trimmed && meta && trimmed !== meta.title) {
      await rename(id, trimmed);
    }
    setEditing(false);
  };

  return (
    <>
      {active && <span className="text-green-400/50 font-bold shrink-0 mr-0.5">{"> "}</span>}
      {editing ? (
        <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") { setEditValue(meta?.title || ""); setEditing(false); }
            }}
            className="flex-1 text-sm px-1 py-0.5 rounded outline-none text-zinc-300 bg-zinc-800"
            autoFocus
          />
        </div>
      ) : (
        <>
          <span
            className={`flex-1 min-w-0 truncate text-sm cursor-pointer ${active ? "text-zinc-300" : "text-zinc-400"}`}
            onClick={(e) => { e.stopPropagation(); setActive(id); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {meta?.title || id.slice(0, 8)}
          </span>
          {streaming && (
            <span title="Streaming…" className="relative flex h-2 w-2 shrink-0 mx-1">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
          )}
          {done && !streaming && (
            <span title="Finished" className="shrink-0 text-sky-400 mx-1">
              <CheckCircle2 size={14} />
            </span>
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all pointer-events-none group-hover:pointer-events-auto">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
              className={`p-1 rounded ${showInfo ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <Info size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void archive(id); }}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300"
            >
              <Archive size={14} />
            </button>
          </div>
        </>
      )}
      {showInfo && meta && (
        <div className="text-[10px] text-zinc-500 truncate col-span-2 mt-0.5 ml-4">
          {new Date(meta.updated).toLocaleDateString()} · {meta.modelName}
        </div>
      )}
    </>
  );
}

function workspaceLabel(root: string): string {
  return root ? root.split("/").filter(Boolean).pop() || root : "No workspace";
}

export function SessionList({ search }: SessionListProps) {
  const { sessions, loading, fetch } = useSessionStore();
  const [focusIdx, setFocusIdx] = useState(-1);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    setFocusIdx(-1);
  }, [search]);

  const filtered = useMemo(
    () =>
      sessions.filter((s) =>
        s.title.toLowerCase().includes(search.toLowerCase())
      ),
    [sessions, search]
  );

  const workspaceMap = useMemo(() => {
    const map = new Map<string, SessionMeta[]>();
    for (const s of filtered) {
      const key = s.workspaceRoot || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const renderActions = useCallback((itemId: string) => {
    return <SessionActions id={itemId} />;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const items = useSessionStore
        .getState()
        .sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(focusIdx + 1, items.length - 1);
        setFocusIdx(next);
        if (items[next]) useSessionStore.getState().setActive(items[next].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(focusIdx - 1, 0);
        setFocusIdx(prev);
        if (items[prev]) useSessionStore.getState().setActive(items[prev].id);
      } else if (e.key === "Escape") {
        setFocusIdx(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, focusIdx]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {loading && (
          <div className="px-2 space-y-2 pt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse space-y-1.5 px-3 py-2">
                <div className="h-3 rounded w-3/4 bg-zinc-800" />
                <div className="h-2 rounded w-1/2 bg-zinc-800" />
              </div>
            ))}
          </div>
        )}
        {workspaceMap.map(([workspace, wsSessions]) => {
          const tree: TreeItems = wsSessions.map((s) => ({
            id: s.id,
            label: s.title,
            variant: "session" as const,
            children: [],
          }));
          return (
            <div key={workspace || "__nows__"} className="mb-2 last:mb-0">
              <p
                className="text-[10px] tracking-wider text-zinc-500 font-medium px-1 pt-2 pb-1.5 truncate"
                title={workspace || undefined}
              >
                {workspaceLabel(workspace)}
              </p>
              <SortableTree
                indicator
                collapsible
                removable
                defaultItems={tree}
                renderActions={renderActions}
                key={`sidebar-${workspace}-${tree.length}`}
              />
            </div>
          );
        })}
        {!loading && workspaceMap.length === 0 && (
          <p className="text-xs text-zinc-600 px-2 py-4 text-center">
            {search ? "No matching sessions" : "No sessions yet"}
          </p>
        )}
      </div>
    </div>
  );
}
