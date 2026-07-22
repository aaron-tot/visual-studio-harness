import { FolderOpen, Globe, Layers } from "lucide-react";
import type { PlanScope } from "../../types";

const OPTIONS: {
  key: PlanScope;
  label: string;
  Icon: typeof Globe;
}[] = [
  { key: "global", label: "Global", Icon: Globe },
  { key: "project", label: "Workspace", Icon: FolderOpen },
  { key: "session", label: "Session", Icon: Layers },
];

interface ScopeSwitcherProps {
  scope: PlanScope;
  onChange: (scope: PlanScope) => void;
}

export function ScopeSwitcher({ scope, onChange }: ScopeSwitcherProps) {
  return (
    <div className="flex gap-0.5">
      {OPTIONS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
            scope === key
              ? "bg-zinc-700 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(key);
          }}
        >
          <Icon size={10} />
          {label}
        </button>
      ))}
    </div>
  );
}
