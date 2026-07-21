import type { PermissionMode } from "../../lib/api";

const MODES: PermissionMode[] = ["allow", "ask", "deny"];

interface Props {
  value: PermissionMode | "";
  onChange: (mode: PermissionMode | "") => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

export function PermModeSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "inherit",
  className = "",
}: Props) {
  return (
    <select
      className={`bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 ${className}`}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") {
          if (allowEmpty) onChange("");
          return;
        }
        onChange(v as PermissionMode);
      }}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {MODES.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
