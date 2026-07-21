import { SortableTree } from "./sortable-tree";

export function TestingTab() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <div className="px-3 py-1.5 text-[9px] text-zinc-600 border-b border-zinc-800/50 space-y-0.5">
        <div>Testing · Sortable Tree</div>
        <div className="text-zinc-700">
          drag · drop · nest
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2">
        <SortableTree collapsible indicator removable />
      </div>
    </div>
  );
}
