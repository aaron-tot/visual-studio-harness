import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Archive, Info, CheckCircle2, Trash2, Palette, AlertTriangle, Plus, MessageSquarePlus, Check, X } from "lucide-react";
import { SortableTree } from "../testing/sortable-tree";
import { useSessionStore } from "../../../sessions/store";
import { useChatStore } from "../../../chat/store";
import type { TreeItems } from "../testing/sortable-tree/types";
import {
  buildWorkspaceTree,
  layoutToTree,
  treeToLayout,
  GROUP_COLOR_KEYS,
  groupColorClass,
} from "../../../sessions/layout";
import type { LayoutNode, GroupColor, SessionMeta } from "../../../../_shared/types";

interface WorkspaceSection {
  root: string;
  tree: LayoutNode[];
}

function workspaceLabel(root: string): string {
  return root ? root.split("/").filter(Boolean).pop() || root : "No workspace";
}

function SessionActions({ id, isDragOverlay }: { id: string; isDragOverlay?: boolean }) {
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleRename = async () => {
    const trimmed = editValue.trim();
    if (trimmed && meta && trimmed !== meta.title) {
      await rename(id, trimmed);
    }
    setEditing(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      data-testid="session-item"
      className="flex flex-1 min-w-0 items-center gap-1.5"
      onContextMenu={isDragOverlay ? undefined : handleContextMenu}
    >
      {active && !editing && <span className="text-green-400/50 font-bold shrink-0">{"> "}</span>}
      {editing ? (
        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            data-testid="session-rename-input"
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
          <button onClick={handleRename} className="p-0.5 text-zinc-500 hover:text-zinc-300"><Check size={14} /></button>
          <button onClick={() => { setEditValue(meta?.title || ""); setEditing(false); }} className="p-0.5 text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
        </div>
      ) : (
        <>
          <div
            className="flex-1 min-w-0"
            onClick={(e) => { e.stopPropagation(); setActive(id); }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            <p className={`text-sm truncate ${active ? "text-zinc-300" : "text-zinc-400"}`}>
              {meta?.title || id.slice(0, 8)}
            </p>
            {showInfo && meta && (
              <p className="text-xs text-zinc-500 truncate">
                {new Date(meta.updated).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {meta.modelName}
              </p>
            )}
          </div>
          {streaming && (
            <span data-testid="session-streaming" title="Streaming…" className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
          )}
          {done && !streaming && (
            <span data-testid="session-done" title="Finished — response ready" className="shrink-0 text-sky-400">
              <CheckCircle2 size={14} />
            </span>
          )}
          {!isDragOverlay && (
            <div className="flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
                className={`p-1 rounded transition-all ${showInfo ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                <Info size={14} />
              </button>
              <button
                type="button"
                data-testid="archive"
                onClick={(e) => { e.stopPropagation(); void archive(id); }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-all"
              >
                <Archive size={14} />
              </button>
            </div>
          )}
        </>
      )}
      {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
      {menu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md bg-zinc-800 border border-zinc-600 shadow-lg py-1"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
            onClick={() => { setMenu(null); setEditing(true); }}
          >
            Rename
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
            onClick={() => { setMenu(null); void archive(id); }}
          >
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

function GroupActions({ id, label, childCount, childSessionIds, onRemove, onUngroup, currentColor, onRecolor }: { id: string; label: string; childCount: number; childSessionIds?: string[]; onRemove?: () => void; onUngroup?: () => void; currentColor?: GroupColor; onRecolor?: (color: GroupColor) => void }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [color, setColor] = useState<GroupColor>(currentColor ?? "neutral");
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Sync local color state when the persisted color changes (e.g. from another session)
  useEffect(() => { setColor(currentColor ?? "neutral"); }, [currentColor]);

  const cls = groupColorClass[color];

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) setValue(trimmed);
    setEditing(false);
  };



  if (confirmArchive) {
    return (
      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-950/30 border-amber-700/50">
        <AlertTriangle size={10} className="text-amber-400 shrink-0" />
        <span className="text-[10px] text-amber-300 flex-1">
          {childCount} session{childCount !== 1 ? "s" : ""} ungroup
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirmArchive(false); }}
          className="text-[10px] px-1 py-0.5 rounded text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirmArchive(false); onUngroup?.(); }}
          className="text-[10px] px-1 py-0.5 rounded bg-amber-600/30 text-amber-300 hover:bg-amber-600/50"
        >
          Go
        </button>
      </div>
    );
  }

  return (
    <>
      {editing ? (
        <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setValue(label); setEditing(false); }
            }}
            className="flex-1 text-sm font-medium px-1 py-0.5 rounded outline-none text-zinc-200 bg-zinc-800"
            autoFocus
          />
        </div>
      ) : (
        <span
          className={`flex-1 truncate text-sm font-medium ${cls.text}`}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        >
          {value}
        </span>
      )}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all pointer-events-none group-hover:pointer-events-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPaletteOpen(!paletteOpen); }}
          className={`p-1 rounded ${paletteOpen ? "text-zinc-300" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          <Palette size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (childCount > 0) { setConfirmArchive(true); return; }
            onRemove?.();
          }}
          className="p-1 rounded text-zinc-500 hover:text-red-400"
        >
          {childCount > 0 ? <Archive size={14} /> : <Trash2 size={14} />}
        </button>
      </div>
      {paletteOpen && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 mt-0.5 rounded bg-zinc-900 border border-zinc-800">
          {GROUP_COLOR_KEYS.map((c) => (
            <button
              key={c}
              type="button"
              className={`w-4 h-4 rounded-full ${groupColorClass[c].dot} ${
                color === c ? "ring-2 ring-offset-1 ring-offset-zinc-900 ring-zinc-300" : ""
              }`}
              onClick={(e) => { e.stopPropagation(); setColor(c); onRecolor?.(c); setPaletteOpen(false); }}
            />
          ))}
        </div>
      )}
    </>
  );
}


export function TestingV3Tab({ search }: { search?: string }) {
  const { sessions, loading, fetch: loadSessions, layouts } = useSessionStore();
  const setActive = useSessionStore((s) => s.setActive);
  const addGroupStore = useSessionStore((s) => s.addGroup);
  const removeGroupStore = useSessionStore((s) => s.removeGroup);
  const saveLayout = useSessionStore((s) => s.saveLayout);
  const recolorGroupStore = useSessionStore((s) => s.recolorGroup);
  const [focusIdx, setFocusIdx] = useState(-1);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const layoutsLoaded = useRef<Set<string>>(new Set());
  // Bump when layout structure changes via UI so SortableTree remounts with new defaultItems
  const [layoutTick, setLayoutTick] = useState(0);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { setFocusIdx(-1); }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const items = useSessionStore.getState().sessions
        .filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase()));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(focusIdx + 1, items.length - 1);
        setFocusIdx(next);
        if (items[next]) setActive(items[next].id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(focusIdx - 1, 0);
        setFocusIdx(prev);
        if (items[prev]) setActive(items[prev].id);
      } else if (e.key === "Escape") {
        setFocusIdx(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, focusIdx, setActive]);

  const filteredSessions = useMemo(
    () => search
      ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
      : sessions,
    [sessions, search],
  );

  const sections: WorkspaceSection[] = useMemo(() => {
    const byRoot = new Map<string, SessionMeta[]>();
    for (const s of filteredSessions) {
      const root = s.workspaceRoot || "";
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root)!.push(s);
    }
    const result: WorkspaceSection[] = [];
    for (const [root, wsSessions] of byRoot) {
      const tree = buildWorkspaceTree(wsSessions, layouts[root]);
      // Mark as loaded if we have sessions for this workspace (layout exists or fresh)
      if (wsSessions.length > 0 && !layoutsLoaded.current.has(root)) {
        layoutsLoaded.current.add(root);
      }
      result.push({ root, tree });
    }
    const noWs = result.find((s) => s.root === "");
    const withWs = result.filter((s) => s.root !== "");
    withWs.sort((a, b) => a.root.localeCompare(b.root));
    return [...(noWs ? [noWs] : []), ...withWs];
  }, [filteredSessions, layouts, layoutTick]);

  const persistTree = useCallback((workspace: string, items: TreeItems) => {
    // Only persist after backend layout has loaded (avoids mount-save race)
    if (!layoutsLoaded.current.has(workspace)) return;
    if (saveTimers.current[workspace]) clearTimeout(saveTimers.current[workspace]);
    saveTimers.current[workspace] = setTimeout(() => {
      const existingTree = useSessionStore.getState().layouts[workspace];
      const tree = treeToLayout(items, existingTree);
      void saveLayout(workspace, tree);
    }, 300);
  }, [saveLayout]);

  const addGroup = useCallback((workspace: string) => {
    void addGroupStore(workspace, "New Group", "neutral").then(() => {
      setLayoutTick((t) => t + 1);
    });
  }, [addGroupStore]);

  const removeGroup = useCallback((workspace: string, groupId: string) => {
    void removeGroupStore(workspace, groupId).then(() => {
      setLayoutTick((t) => t + 1);
    });
  }, [removeGroupStore]);

  const isGroupId = useCallback((itemId: string) => {
    function findInTree(nodes: LayoutNode[]): boolean {
      for (const n of nodes) {
        if (n.id === itemId && n.kind === "group") return true;
        if (n.children && findInTree(n.children)) return true;
      }
      return false;
    }
    return Object.values(layouts).some((tree) => findInTree(tree));
  }, [layouts]);

  const renderActions = useCallback(
    (itemId: string, label: string, childCount?: number, _requestRemove?: () => void, isDragOverlay?: boolean, childSessionIds?: string[]) => {
      // Find workspace owning this group and its current color
      let ws: string | undefined;
      let groupColor: GroupColor | undefined;
      for (const [w, tree] of Object.entries(layouts)) {
        function findGroupNode(nodes: LayoutNode[]): LayoutNode | undefined {
          for (const n of nodes) {
            if (n.id === itemId && n.kind === "group") return n;
            if (n.children) {
              const found = findGroupNode(n.children);
              if (found) return found;
            }
          }
          return undefined;
        }
        const node = findGroupNode(tree);
        if (node) { ws = w; groupColor = node.color; break; }
      }
      if (ws != null && isGroupId(itemId)) {
        return (
          <GroupActions
            id={itemId}
            label={label}
            childCount={childCount ?? 0}
            childSessionIds={childSessionIds}
            currentColor={groupColor}
            onRecolor={(color) => void recolorGroupStore(ws!, itemId, color)}
            onRemove={() => removeGroup(ws!, itemId)}
            onUngroup={() => {
              // Recursively collect all sessions in this group and sub-groups
              const tree = layouts[ws!];
              if (!tree) return;
              function collectSessionIds(nodes: LayoutNode[]): string[] {
                const ids: string[] = [];
                for (const n of nodes) {
                  if (n.kind === "session") ids.push(n.id);
                  if (n.children) ids.push(...collectSessionIds(n.children));
                }
                return ids;
              }
              function findGroupNode(nodes: LayoutNode[]): LayoutNode | undefined {
                for (const n of nodes) {
                  if (n.id === itemId) return n;
                  if (n.children) {
                    const found = findGroupNode(n.children);
                    if (found) return found;
                  }
                }
                return undefined;
              }
              const group = findGroupNode(tree);
              if (group) {
                for (const sid of collectSessionIds(group.children || [])) {
                  void useSessionStore.getState().archive(sid);
                }
              }
            }}
          />
        );
      }
      return <SessionActions id={itemId} isDragOverlay={isDragOverlay} />;
    },
    [layouts, isGroupId, removeGroup, recolorGroupStore],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <div className="px-3 py-1.5 text-[9px] text-zinc-600 border-b border-zinc-800/50">
        <div>Sessions</div>
        <div className="text-zinc-700">drag sessions under a group</div>
      </div>
      <div className="flex-1 min-h-0 p-2 space-y-4">
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
        {!loading && sections.length === 0 && (
          <p className="text-xs text-zinc-600 px-2 py-4 text-center">
            {search ? "No matching sessions" : "No sessions yet"}
          </p>
        )}
        {sections.map(({ root, tree }) => (
          <div key={root}>
            <div className="flex items-center gap-1 px-1 pt-2 pb-1.5 group">
              <span className="flex-1 text-[10px] tracking-wider text-zinc-500 font-medium truncate">
                {workspaceLabel(root)}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  type="button"
                  title="New chat in this workspace"
                  onClick={() => {
                    useChatStore.getState().clearMessages();
                    useChatStore.getState().setWorkspaceRoot(root);
                  }}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                >
                  <MessageSquarePlus size={12} />
                </button>
                <button
                  type="button"
                  title="Add group"
                  onClick={() => addGroup(root)}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            <SortableTree
              collapsible
              indicator
              removable
              defaultItems={layoutToTree(tree, new Map(filteredSessions.map(s => [s.id, s])))}
              renderActions={renderActions}
              onItemsChange={(items) => persistTree(root, items)}
              key={`${root}-${layoutTick}-${tree.map(n => n.id).join(",")}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

