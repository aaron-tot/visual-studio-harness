import { Terminal } from "lucide-react";
import type { Shell } from "../types";

interface ShellTerminalProps {
  shell: Shell;
}

/**
 * Placeholder shell UI rendered in the session panel's main content area.
 * Real PTY integration will replace the surface here in a later phase.
 */
export function ShellTerminal({ shell }: ShellTerminalProps) {
  return (
    <div className="h-full flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      {/* Shell label row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/70 text-xs text-zinc-400">
        <Terminal size={13} className="text-zinc-500" />
        <span className="truncate">{shell.name}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-zinc-600">
          {shell.status}
        </span>
      </div>

      {/* Placeholder body */}
      <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 px-4">
        Shell “{shell.name}” will run here
      </div>
    </div>
  );
}
