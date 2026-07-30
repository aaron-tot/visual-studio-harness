import { FolderOpen, Globe, Layers } from "lucide-react";
import type { PlanScope } from "../types";

const OPTIONS: {
  key: PlanScope;
  label: string;
  Icon: typeof Globe;
}[] = [
  { key: "global", label: "Global", Icon: Globe },
  { key: "project", label: "Workspace", Icon: FolderOpen },
  { key: "session", label: "Session", Icon: Layers },
];

interface ScopePickerProps {
  scope: PlanScope;
  onChange: (scope: PlanScope) => void;
}

/** Icons-only scope picker — no text labels. */
export function ScopePicker({ scope, onChange }: ScopePickerProps) {
  return (
    <div className="flex gap-0.5 items-center justify-center">
      {OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
            scope === key
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(key);
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
