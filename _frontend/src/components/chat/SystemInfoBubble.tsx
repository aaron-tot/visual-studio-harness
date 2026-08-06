import { memo, useState } from "react";
import { useConfigStore } from "../../stores/config";

export type SystemInfoVisibility = "hidden" | "collapsed" | "expanded";

const DEFAULT_VISIBILITY: SystemInfoVisibility = "collapsed";

/**
 * Renders a persisted `additional_system_info` injection inside the agent
 * bubble. It is context (not a real tool execution), so it is shown as a
 * distinct muted, collapsed block with expand-on-click — never as a normal
 * tool-call card. Honors the config `additionalSystemInfo.visibility` setting
 * (per-agent when `agentName` resolves, else global): hidden ⇒ renders
 * nothing; expanded ⇒ pre-expanded; collapsed ⇒ header only.
 */
export function SystemInfoBubble({ content, agentName }: { content: string; agentName?: string }) {
  const visibility = useConfigStore(
    (s) =>
      (agentName ? s.config.agents?.[agentName]?.additionalSystemInfo?.visibility : undefined) ??
      s.config.additionalSystemInfo?.visibility ??
      DEFAULT_VISIBILITY,
  );
  const [userOpen, setUserOpen] = useState(false);
  // Config "expanded" forces open; otherwise honor the user's toggle. Derived
  // (not useState-initialized) so a settings change re-renders correctly.
  const open = visibility === "expanded" ? true : userOpen;

  if (visibility === "hidden") return null;

  return (
    <div className="rounded-md px-3 py-1.5 text-xs w-full bg-zinc-800/40 border border-zinc-700/40 text-zinc-400">
      <button
        type="button"
        onClick={() => setUserOpen((v) => !v)}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 font-mono"
      >
        <span>{open ? "▾" : "▸"}</span> additional_system_info
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-zinc-500 overflow-x-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

export const MemoSystemInfoBubble = memo(SystemInfoBubble);
