import type { GroupColor, SessionMeta } from "../../../_shared/types";
import type { SessionGroupLayout } from "../../features/sessions/layout";
import { GroupItem } from "./GroupItem";
import { SessionItem } from "./SessionItem";

export interface SortableRowItem {
  id: string;
  kind: "group" | "session";
  depth: number;
  groupId: string | null;
  group: SessionGroupLayout | null;
}

interface SortableRowProps {
  item: SortableRowItem;
  activeSessionId: string | null;
  byId: Map<string, SessionMeta>;
  streamingSessions: Record<string, true>;
  doneNotifications: Record<string, true>;
  formatDate: (iso: string) => string;
  onSelectSession: (id: string | null) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameGroup: (id: string, title: string) => void;
  onRecolorGroup: (id: string, color: GroupColor) => void;
  onDeleteGroup: (id: string) => void;
}

export function SortableRow({
  item,
  activeSessionId,
  byId,
  streamingSessions,
  doneNotifications,
  formatDate,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onRenameGroup,
  onRecolorGroup,
  onDeleteGroup,
}: SortableRowProps) {
  // --- Group header row ---
  if (item.kind === "group" && item.group) {
    return (
      <div>
        <GroupItem
          group={item.group}
          onRename={(title) => onRenameGroup(item.id, title)}
          onRecolor={(color) => onRecolorGroup(item.id, color)}
          onDelete={() => onDeleteGroup(item.id)}
        />
      </div>
    );
  }

  // --- Session row ---
  const meta = byId.get(item.id);
  return (
    <div
      data-testid="session-row"
      data-session-id={item.id}
      className={`${item.depth > 0 ? "ml-4" : ""}`}
    >
      <SessionItem
        id={item.id}
        title={meta?.title ?? item.id}
        subtitle={meta ? `${formatDate(meta.updated)} · ${meta.modelName}` : ""}
        active={activeSessionId === item.id}
        streaming={!!streamingSessions[item.id]}
        done={!!doneNotifications[item.id]}
        onSelect={() => onSelectSession(item.id)}
        onRename={async (t) => onRenameSession(item.id, t)}
        onDelete={() => onDeleteSession(item.id)}
      />
    </div>
  );
}
