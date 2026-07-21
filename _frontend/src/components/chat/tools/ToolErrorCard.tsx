/**
 * ToolErrorCard
 *
 * Expandable error card for failed tool calls.
 * Based on OpenCode's tool-error-card.tsx — shows error details
 * with expand/collapse and a copy-to-clipboard button.
 */

import { useState } from "react";

interface ToolErrorCardProps {
  toolName: string;
  error: string;
}

export function ToolErrorCard({ toolName, error }: ToolErrorCardProps) {
  const [expanded, setExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
  };

  return (
    <div className="border border-red-500/30 bg-red-500/5 rounded-lg overflow-hidden my-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <span className="font-medium">{toolName} failed</span>
        <span className="text-red-400/60 shrink-0">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-red-500/20 px-3 py-2">
          <pre className="text-[10px] text-red-300/80 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
            {error}
          </pre>
          <button
            onClick={handleCopy}
            className="mt-1.5 text-[9px] uppercase tracking-wider text-red-400/50 hover:text-red-400 transition-colors"
          >
            Copy error
          </button>
        </div>
      )}
    </div>
  );
}
