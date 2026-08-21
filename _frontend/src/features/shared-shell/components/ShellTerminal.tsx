import { useState, useRef, useEffect } from "react";
import { Terminal } from "lucide-react";
import { useSharedShellStore } from "../store";
import type { Shell } from "../types";

interface ShellTerminalProps {
  shell: Shell;
}

/**
 * Interactive shell surface: shows live output and lets the user type a command
 * to send to the backend shell process. Output is streamed over WS into the
 * store's `outputByShell` buffer.
 */
export function ShellTerminal({ shell }: ShellTerminalProps) {
  const [command, setCommand] = useState("");
  const outputBodyRef = useRef<HTMLDivElement>(null);
  const output = useSharedShellStore((s) => s.outputByShell[shell.id] ?? "");
  const writeShell = useSharedShellStore((s) => s.writeShell);

  // Auto-scroll to bottom on new output.
  useEffect(() => {
    if (outputBodyRef.current) {
      outputBodyRef.current.scrollTop = outputBodyRef.current.scrollHeight;
    }
  }, [output]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = command;
    if (!trimmed) return;
    setCommand("");
    try {
      // Send the command plus a newline to execute it.
      await writeShell(shell.id, trimmed + "\n");
    } catch (err) {
      console.error("Failed to write to shell:", err);
    }
  };

  return (
    <div className="h-full flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/70 text-xs text-zinc-400">
        <Terminal size={13} className="text-zinc-500" />
        <span className="truncate">{shell.name}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-zinc-600">{shell.status}</span>
      </div>

      {/* Output area */}
      <div
        ref={outputBodyRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs text-zinc-300 whitespace-pre-wrap break-all min-h-0"
      >
        {output || (
          <span className="text-zinc-600">
            Shell ready. Type a command below and press Enter.
          </span>
        )}
      </div>

      {/* Command input */}
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-zinc-800/70 px-2 py-1.5">
        <span className="text-emerald-400 select-none">›</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Type a command…"
          className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
