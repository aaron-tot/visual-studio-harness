import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Message } from "../../../_shared/types/message";

interface SummaryCardProps {
  message: Message;
}

export function SummaryCard({ message }: SummaryCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const endTurn = message.summaryEndTurn;
  const label = endTurn != null ? `Summary · up to turn ${endTurn}` : "Summary";

  return (
    <div className="my-2 mx-1 rounded-lg border border-blue-500/30 bg-blue-500/5">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-zinc-900"
        onClick={() => setIsOpen((v) => !v)}
      >
        {isOpen ? <ChevronDown size={14} className="text-blue-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-blue-400 flex-shrink-0" />}
        <span className="text-[10px] font-medium uppercase tracking-wider text-blue-400">{label}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
        </div>
      )}
    </div>
  );
}
