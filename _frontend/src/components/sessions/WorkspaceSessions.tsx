import { useMemo } from "react";
import { Plus } from "lucide-react";
import type { SessionMeta } from "../../../_shared/types";
import { useSessionStore } from "../../features/sessions/store";
import { buildWorkspaceLayout } from "../../features/sessions/layout";
import { SortableRow } from "./SortableRow";

interface WorkspaceSessionsProps {
  workspace: string;
  label: string;
  sessions: SessionMeta[];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function WorkspaceSessions({ workspace, label, sessions }: WorkspaceSessionsProps) {
  const layout = useSessionStore((s) => s.layouts[workspace]);
  const activeId = useSessionStore((s) => s.activeId);
  const setActive = useSessionStore((s) => s.setActive);
  const rename = useSessionStore((s) => s.rename);
  const archive = useSessionStore((s) => s.archive);
  const addGroup = useSessionStore((s) => s.addGroup);
  const renameGroup = useSessionStore((s) => s.renameGroup);
  const recolorGroup = useSessionStore((s) => s.recolorGroup);
  const removeGroup = useSessionStore((s) => s.removeGroup);
  const streamingSessions = useSessionStore((s) => s.streamingSessions);
  const doneNotifications = useSessionStore((s) => s.doneNotifications);

  const merged = useMemo(
    () => buildWorkspaceLayout(workspace, sessions, layout),
    [workspace, sessions, layout],
  );

  const byId = useMemo(() => {
    const m = new Map<string, SessionMeta>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  return (
    <div className="mb-2 last:mb-0">
      <p
        className="text-[10px] tracking-wider text-zinc-500 font-medium px-1 pt-2 pb-1.5 truncate"
        title={workspace || undefined}
      >
        {label}
      </p>

      {merged.groups.map((group) => (
        <div key={group.id}>
          <SortableRow
            item={{ id: group.id, kind: "group", depth: 0, groupId: null, group }}
            activeSessionId={activeId}
            byId={byId}
            streamingSessions={streamingSessions}
            doneNotifications={doneNotifications}
            formatDate={formatDate}
            onSelectSession={setActive}
            onRenameSession={(sid, title) => rename(sid, title)}
            onDeleteSession={(sid) => void archive(sid)}
            onRenameGroup={(gid, title) => void renameGroup(workspace, gid, title)}
            onRecolorGroup={(gid, color) => void recolorGroup(workspace, gid, color)}
            onDeleteGroup={(gid) => void removeGroup(workspace, gid)}
          />
          {group.sessionIds.map((sid) => (
            <SortableRow
              key={sid}
              item={{ id: sid, kind: "session", depth: 1, groupId: group.id, group: null }}
              activeSessionId={activeId}
              byId={byId}
              streamingSessions={streamingSessions}
              doneNotifications={doneNotifications}
              formatDate={formatDate}
              onSelectSession={setActive}
              onRenameSession={(sid2, title) => rename(sid2, title)}
              onDeleteSession={(sid2) => void archive(sid2)}
              onRenameGroup={(gid, title) => void renameGroup(workspace, gid, title)}
              onRecolorGroup={(gid, color) => void recolorGroup(workspace, gid, color)}
              onDeleteGroup={(gid) => void removeGroup(workspace, gid)}
            />
          ))}
        </div>
      ))}

      {merged.ungrouped.map((sid) => (
        <SortableRow
          key={sid}
          item={{ id: sid, kind: "session", depth: 0, groupId: null, group: null }}
          activeSessionId={activeId}
          byId={byId}
          streamingSessions={streamingSessions}
          doneNotifications={doneNotifications}
          formatDate={formatDate}
          onSelectSession={setActive}
          onRenameSession={(sid2, title) => rename(sid2, title)}
          onDeleteSession={(sid2) => void archive(sid2)}
          onRenameGroup={(gid, title) => void renameGroup(workspace, gid, title)}
          onRecolorGroup={(gid, color) => void recolorGroup(workspace, gid, color)}
          onDeleteGroup={(gid) => void removeGroup(workspace, gid)}
        />
      ))}

      <button
        type="button"
        data-testid="add-group"
        onClick={() => void addGroup(workspace, "New Group", "neutral")}
        className="mt-1.5 flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 rounded transition-all"
      >
        <Plus size={12} /> Add group
      </button>
    </div>
  );
}
