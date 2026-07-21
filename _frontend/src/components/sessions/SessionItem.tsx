import { useState } from "react";
import { Archive, Check, X, Info, CheckCircle2 } from "lucide-react";
import { SessionContextMenu } from "./SessionContextMenu";

interface SessionItemProps {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  streaming?: boolean;
  done?: boolean;
  onSelect: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
}

export function SessionItem({ id, title, subtitle, active, streaming, done, onSelect, onRename, onDelete }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const [showInfo, setShowInfo] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleRename = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      await onRename(trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleRename();
    if (e.key === "Escape") {
      setEditValue(title);
      setEditing(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      data-testid="session-item"
      className="group flex items-center gap-1.5 px-2.5 py-1 cursor-pointer transition-all hover:bg-zinc-800/20"
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      {editing ? (
        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={handleKeyDown}
            className="flex-1 text-sm px-1 py-0.5 rounded outline-none text-zinc-300"
            autoFocus
            data-testid="session-rename-input"
          />
          <button onClick={handleRename} className="p-0.5 text-zinc-500 hover:text-zinc-300"><Check size={14} /></button>
          <button onClick={() => { setEditValue(title); setEditing(false); }} className="p-0.5 text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
        </div>
      ) : (
        <>
          {active && <span className="text-green-400/50 font-bold shrink-0">{"> "}</span>}
          <div className="flex-1 min-w-0" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
            <p className={`text-sm truncate ${active ? "text-zinc-300" : "text-zinc-400"}`}>{title}</p>
            {showInfo && <p className="text-xs text-zinc-500 truncate">{subtitle}</p>}
          </div>
          {streaming && (
            <span
              data-testid="session-streaming"
              title="Streaming…"
              className="relative flex h-2 w-2 shrink-0"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
          )}
          {done && !streaming && (
            <span
              data-testid="session-done"
              title="Finished — response ready"
              className="shrink-0 text-sky-400"
            >
              <CheckCircle2 size={14} />
            </span>
          )}
          {/* pointer-events-none until hover: opacity-0 buttons still receive
              clicks otherwise (Playwright + real mouse in headed e2e were
              archiving sessions mid-flick when hovering the row). */}
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
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-all"
            >
              <Archive size={14} />
            </button>
          </div>
        </>
      )}
      {menu && (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          onRename={() => {
            setMenu(null);
            setEditing(true);
          }}
          onArchive={() => {
            setMenu(null);
            onDelete();
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
