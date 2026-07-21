import { useEffect, useRef } from "react";

interface SessionContextMenuProps {
  x: number;
  y: number;
  onRename: () => void;
  onArchive: () => void;
  onClose: () => void;
}

export function SessionContextMenu({ x, y, onRename, onArchive, onClose }: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const items = [
    { label: "Rename", testid: "session-menu-rename", action: onRename },
    { label: "Archive", testid: "session-menu-archive", action: onArchive },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md bg-zinc-800 border border-zinc-600 shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          data-testid={item.testid}
          onClick={(e) => {
            e.stopPropagation();
            item.action();
          }}
          className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
