import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "./MarkdownComponents";
import { remarkLinkPaths } from "../../../lib/remark-link-paths";
// NOTE: Path detection is custom regex-based. If issues arise, consider using
// react-linkify-it or link-harvester instead of the custom remark plugin.
import { useChatStore } from "../../../stores/chat";
import { FileLinkContextMenu } from "../links/FileLinkContextMenu";

interface MarkdownProps {
  content: string;
  className?: string;
}

async function openPath(path: string, action: "open" | "open-parent", workspaceRoot: string) {
  try {
    await fetch("/api/open-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, action, workspaceRoot }),
    });
  } catch {
    // silent
  }
}

function getLinkStyle(type?: string) {
  if (type === "folder") return "text-emerald-400 hover:text-emerald-300 cursor-pointer";
  if (type === "file") return "text-purple-400 hover:text-purple-300 cursor-pointer";
  return "text-blue-400 underline underline-offset-2 hover:text-blue-300 cursor-pointer";
}

function MarkdownFileLink({ filePath, linkType, children }: { filePath: string; linkType: string; children: React.ReactNode }) {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openPath(filePath, "open", workspaceRoot);
    },
    [filePath, workspaceRoot]
  );

  const handleContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(e as any); }}
        onContextMenu={handleContext}
        className={getLinkStyle(linkType)}
        title={filePath}
      >
        {children}
      </span>
      {ctxMenu && (
        <FileLinkContextMenu x={ctxMenu.x} y={ctxMenu.y} path={filePath} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}

export function Markdown({ content, className = "" }: MarkdownProps) {
  if (!content) return null;

  return (
    <div className={`markdown-body min-w-0 max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkLinkPaths]}
        components={{
          ...markdownComponents,
          a: ({ href, children, ...props }: any) => {
            const linkType = props["data-link-type"];
            if (linkType === "file" || linkType === "folder") {
              const filePath = props.title || href || "";
              return <MarkdownFileLink filePath={filePath} linkType={linkType}>{children}</MarkdownFileLink>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className={getLinkStyle("url")} {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
