import React, { useEffect, useRef } from "react";
import { useChatStore } from "../../../stores/chat";

interface FileLinkContextMenuProps {
  x: number;
  y: number;
  path: string;
  onClose: () => void;
}

async function openPath(path: string, action: "open" | "open-parent", workspaceRoot: string) {
  try {
    await fetch("/api/open-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, action, workspaceRoot }),
    });
  } catch {}
}

function copyToClipboard(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function getRelativePath(absolutePath: string, workspaceRoot: string): string {
  if (!workspaceRoot) return absolutePath;
  const normalized = absolutePath.replace(/\\/g, "/");
  const base = workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.startsWith(base + "/")) {
    return normalized.slice(base.length + 1);
  }
  return absolutePath;
}

export function FileLinkContextMenu({ x, y, path, onClose }: FileLinkContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

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
    { label: "Open file", action: () => openPath(path, "open", workspaceRoot) },
    { label: "Open containing folder", action: () => openPath(path, "open-parent", workspaceRoot) },
    { type: "separator" as const },
    { label: "Copy full path", action: () => copyToClipboard(path) },
    { label: "Copy relative path", action: () => copyToClipboard(getRelativePath(path, workspaceRoot)) },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md bg-zinc-800 border border-zinc-600 shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item.type === "separator" ? (
          <div key={i} className="my-1 border-t border-zinc-600" />
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              item.action();
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white"
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
