import type { GroupColor, LayoutNode, SessionMeta } from "../../../../_shared/types";
import type { TreeItem, TreeItems } from "../info-panel/components/testing/sortable-tree/types";

export interface WorkspaceSection {
  root: string;
  tree: LayoutNode[];
}

/** A session group in the workspace list UI (id + display name + children). */
export interface SessionGroupLayout {
  id: string;
  name: string;
  color?: GroupColor;
  sessionIds: string[];
}

/**
 * Flatten a LayoutNode[] workspace tree into list rows: ordered groups (with
 * their session ids) plus ungrouped sessions. Sessions in the tree but absent
 * from the live session list are skipped.
 */
export function buildWorkspaceLayout(
  _workspace: string,
  sessions: SessionMeta[],
  tree?: LayoutNode[]
): { groups: SessionGroupLayout[]; ungrouped: string[] } {
  const validIds = new Set(sessions.map((s) => s.id));
  const groups: SessionGroupLayout[] = [];
  const groupedIds = new Set<string>();

  const walk = (nodes: LayoutNode[]) => {
    for (const n of nodes) {
      if (n.kind !== "group") continue;
      const sessionIds = (n.children ?? [])
        .filter((c): c is LayoutNode & { kind: "session" } => c.kind === "session" && validIds.has(c.id))
        .map((c) => c.id);
      sessionIds.forEach((id) => groupedIds.add(id));
      groups.push({ id: n.id, name: n.name ?? "", color: n.color, sessionIds });
      walk(n.children ?? []);
    }
  };
  walk(buildWorkspaceTree(sessions, tree));

  const ungrouped = sessions.map((s) => s.id).filter((id) => !groupedIds.has(id));
  return { groups, ungrouped };
}

export const GROUP_COLOR_KEYS: GroupColor[] = [
  "neutral", "red", "orange", "amber",
  "green", "blue", "violet", "pink",
];

export const groupColorClass: Record<
  GroupColor,
  { text: string; border: string; bg: string; dot: string }
> = {
  neutral: { text: "text-zinc-400", border: "border-zinc-700", bg: "bg-zinc-800/40", dot: "bg-zinc-500" },
  red: { text: "text-red-400", border: "border-red-700/70", bg: "bg-red-950/40", dot: "bg-red-500" },
  orange: { text: "text-orange-400", border: "border-orange-700/70", bg: "bg-orange-950/40", dot: "bg-orange-500" },
  amber: { text: "text-amber-400", border: "border-amber-700/70", bg: "bg-amber-950/40", dot: "bg-amber-500" },
  green: { text: "text-green-400", border: "border-green-700/70", bg: "bg-green-950/40", dot: "bg-green-500" },
  blue: { text: "text-blue-400", border: "border-blue-700/70", bg: "bg-blue-950/40", dot: "bg-blue-500" },
  violet: { text: "text-violet-400", border: "border-violet-700/70", bg: "bg-violet-950/40", dot: "bg-violet-500" },
  pink: { text: "text-pink-400", border: "border-pink-700/70", bg: "bg-pink-950/40", dot: "bg-pink-500" },
};

/**
 * Convert backend LayoutNode[] tree to SortableTree's TreeItem[] format.
 * Both are recursive trees — this is a trivial rename+label mapping.
 */
export function layoutToTree(nodes: LayoutNode[], byId: Map<string, SessionMeta>): TreeItem[] {
  return nodes
    .filter((n) => {
      if (n.kind === "group") return true;
      return byId.has(n.id);
    })
    .map((n) => {
      if (n.kind === "group") {
        return {
          id: n.id,
          label: n.name || n.id,
          variant: "group" as const,
          children: layoutToTree(n.children || [], byId),
        };
      }
      return {
        id: n.id,
        label: byId.get(n.id)?.title || n.id.slice(0, 8),
        variant: "session" as const,
        children: [],
      };
    });
}

/**
 * Convert SortableTree's TreeItem[] back to LayoutNode[] for storage.
 * This IS the persistence format — no intermediate representation.
 */
export function treeToLayout(items: TreeItem[], existingTree?: LayoutNode[]): LayoutNode[] {
  const colorMap = new Map<string, GroupColor>();
  function collectColors(nodes: LayoutNode[]) {
    for (const n of nodes) {
      if (n.kind === "group" && n.color) colorMap.set(n.id, n.color);
      if (n.children) collectColors(n.children);
    }
  }
  if (existingTree) collectColors(existingTree);

  return items.map((item) => {
    if (item.variant === "group") {
      return {
        kind: "group" as const,
        id: String(item.id),
        name: item.label || String(item.id),
        color: colorMap.get(String(item.id)) || "neutral",
        children: treeToLayout(item.children || []),
      };
    }
    return {
      kind: "session" as const,
      id: String(item.id),
    };
  });
}

/**
 * Build the complete tree for a workspace by merging persisted layout with live sessions.
 * - No layout yet → all sessions ungrouped at root, newest-first.
 * - Stale session refs are dropped; new sessions appended at root (newest-first).
 */
export function buildWorkspaceTree(
  sessions: SessionMeta[],
  tree?: LayoutNode[]
): LayoutNode[] {
  if (!tree) {
    return sessions
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map((s) => ({ kind: "session" as const, id: s.id }));
  }

  const validIds = new Set(sessions.map((s) => s.id));
  const known = new Set<string>();

  function filterTree(nodes: LayoutNode[]): LayoutNode[] {
    return nodes
      .filter((n) => {
        if (n.kind === "group") return true;
        if (validIds.has(n.id) && !known.has(n.id)) {
          known.add(n.id);
          return true;
        }
        return false;
      })
      .map((n) => {
        if (n.kind === "group") {
          return {
            ...n,
            children: filterTree(n.children || []),
          };
        }
        return n;
      });
  }

  const filtered = tree ? filterTree(tree) : [];

  // Append sessions not in the tree (new sessions)
  const missing = sessions
    .filter((s) => !known.has(s.id))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map((s) => ({ kind: "session" as const, id: s.id }));

  return [...filtered, ...missing];
}
