import { ChevronRight } from "lucide-react";

interface ReasoningPartProps {
  content: string;
}

export function ReasoningPart({ content }: ReasoningPartProps) {
  return (
    <details className="group border border-zinc-700 rounded-lg overflow-hidden my-2">
      <summary className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 bg-zinc-800/50 cursor-pointer hover:bg-zinc-800 select-none">
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
        Reasoning
      </summary>
      <div className="px-3 py-2 text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </details>
  );
}
