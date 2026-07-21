import type { SnippetConfig } from "../../../_shared/types";

interface SnippetMenuProps {
  open: boolean;
  selectedIdx: number;
  menuPos: { x: number; y: number } | null;
  snippets: SnippetConfig[];
}

export function SnippetMenu({ open, selectedIdx, menuPos, snippets }: SnippetMenuProps) {
  if (!open || snippets.length === 0 || !menuPos) return null;

  return (
    <div
      className="fixed z-[9999] min-w-[220px] max-w-[320px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/50 overflow-hidden"
      style={{ left: menuPos.x, top: menuPos.y - 8 }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-600 font-medium border-b border-zinc-800">
        Snippets
      </div>
      <div className="max-h-[240px] overflow-y-auto py-1">
        {snippets.map((snippet, idx) => (
          <div
            key={idx}
            className={`px-3 py-2 text-xs cursor-default ${
              idx === selectedIdx
                ? "bg-blue-600/20 text-blue-300 border-l-2 border-blue-500"
                : "text-zinc-300 border-l-2 border-transparent"
            }`}
          >
            <div className="font-medium truncate">{snippet.name}</div>
            <div className="text-[10px] text-zinc-500 truncate mt-0.5">{snippet.content}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-1 text-[10px] text-zinc-600 border-t border-zinc-800 flex items-center gap-1.5">
        <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px]">Alt</kbd>
        <span>hold + scroll · release to insert</span>
      </div>
    </div>
  );
}
