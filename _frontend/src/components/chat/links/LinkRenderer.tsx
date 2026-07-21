import React, { useState, useCallback } from "react";
import { extractLinks, LinkType } from "../../../lib/link-utils";
// NOTE: Path detection is custom regex-based. If issues arise, consider using
// linkify-it for URLs + a path detection lib for file/folder paths.
import { useChatStore } from "../../../stores/chat";
import { FileLinkContextMenu } from "./FileLinkContextMenu";

interface LinkRendererProps {
  text: string;
  className?: string;
}

async function openLink(type: LinkType, value: string, workspaceRoot: string): Promise<void> {
  if (type === "url") {
    try {
      const res = await fetch("/api/open-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      window.open(value, "_blank", "noopener,noreferrer");
    }
    return;
  }

  // file or folder
  try {
    const res = await fetch("/api/open-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: value, action: "open", workspaceRoot }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // silent
  }
}

function LinkItem({ type, value }: { type: LinkType; value: string }) {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      openLink(type, value, workspaceRoot);
    },
    [type, value, workspaceRoot]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (type === "url") return;
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [type]
  );

  const styles = {
    url: "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-400",
    folder: "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-400",
    file: "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border-purple-400",
  };

  const displayValue = type === "url" ? `🌐 ${value}` : value;

  const isUrl = type === "url";

  if (isUrl) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] cursor-pointer select-text border ${styles[type]} hover:opacity-80 whitespace-nowrap`}
        title={value}
      >
        <span className="select-text">{displayValue}</span>
      </a>
    );
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(e as any); }}
        onContextMenu={handleContextMenu}
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] cursor-pointer select-text border ${styles[type]} hover:opacity-80 whitespace-nowrap`}
        title={value}
      >
        <span className="select-text">{displayValue}</span>
      </span>
      {ctxMenu && (
        <FileLinkContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          path={value}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

export function LinkRenderer({ text, className = "" }: LinkRendererProps) {
  const links = extractLinks(text);

  return (
    <span className={className}>
      {links.map((link, index) => (
        <LinkItem key={`${link.type}-${index}`} type={link.type} value={link.value} />
      ))}
    </span>
  );
}
