import { Terminal, X } from "lucide-react";
import type { Shell } from "../types";

interface ShellListProps {
  shells: Shell[];
  activeShellId: string | null;
  onSelect: (shellId: string) => void;
  onClose: (shellId: string) => void;
}

export function ShellList({ shells, activeShellId, onSelect, onClose }: ShellListProps) {
  if (shells.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-zinc-600">
        No shells
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {shells.map((shell) => {
        const active = shell.id === activeShellId;
        return (
          <div
            key={shell.id}
            onClick={() => onSelect(shell.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
              active
                ? "bg-zinc-700/50 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
            }`}
            title={shell.name}
          >
            <Terminal size={13} className="shrink-0 text-zinc-500" />
            <span className="flex-1 truncate min-w-0">{shell.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(shell.id);
              }}
              className="shrink-0 p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60"
              aria-label={`Close ${shell.name}`}
              title="Close shell"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
