import { ChevronDown } from "lucide-react";
import { EmptyState, PanelSectionTitle } from "../ui";

export function AuditsSection() {
  return (
    <div className="flex-[3] flex flex-col min-h-0 overflow-y-auto">
      <div className="px-3 pt-3 pb-2 border-b border-zinc-800">
        <PanelSectionTitle>
          <ChevronDown size={12} />
          Audits
        </PanelSectionTitle>
      </div>
      <EmptyState>Audit files will be displayed here from the agents</EmptyState>
    </div>
  );
}
