import { useMemo } from "react";
import { SortableTree } from "../testing/sortable-tree";
import { useSessionStore } from "../../../sessions/store";
import type { TreeItems } from "../testing/sortable-tree/types";

const GROUP_NAMES = ["Group 1", "Group 2"];

interface WorkspaceSection {
  root: string;
  tree: TreeItems;
}

export function TestingV2Tab() {
  const sessions = useSessionStore((s) => s.sessions);

  const sections: WorkspaceSection[] = useMemo(() => {
    const byRoot = new Map<string, TreeItems>();
    for (const s of sessions) {
      const root = s.workspaceRoot || "(no workspace)";
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root)!.push({
        id: s.id,
        label: s.title || s.id.slice(0, 8),
        children: [],
      });
    }
    const result: WorkspaceSection[] = [];
    for (const [root, sessionItems] of byRoot) {
      const groups: TreeItems = GROUP_NAMES.map((name) => ({
        id: name,
        label: name,
        children: [],
      }));
      result.push({ root, tree: [...sessionItems, ...groups] });
    }
    return result;
  }, [sessions]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <div className="px-3 py-1.5 text-[9px] text-zinc-600 border-b border-zinc-800/50">
        <div>Testing V2 · Sessions by Workspace</div>
        <div className="text-zinc-700">drag sessions under a group</div>
      </div>
      <div className="flex-1 min-h-0 p-2 space-y-4">
        {sections.map(({ root, tree }) => (
          <div key={root}>
            <div className="text-[10px] text-zinc-500 px-1 pb-1 font-mono truncate">
              {root}
            </div>
            <SortableTree
              collapsible
              indicator
              removable
              defaultItems={tree}
              key={`${root}-${tree.length}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
