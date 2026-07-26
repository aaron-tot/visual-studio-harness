import { useState } from "react";

export type ViewMode = "pretty" | "raw";

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800/50">
      <ToggleBtn active={mode === "pretty"} onClick={() => onChange("pretty")}>Pretty</ToggleBtn>
      <ToggleBtn active={mode === "raw"} onClick={() => onChange("raw")}>Raw</ToggleBtn>
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
        active ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RawPanel({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    onCopy?.();
  };
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-end px-2 py-0.5 border-b border-zinc-800/50">
        <button
          className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
            copied ? "bg-emerald-800/60 text-emerald-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={handleCopy}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="flex-1 overflow-auto px-3 py-2 text-[10px] font-mono text-zinc-300 whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}
