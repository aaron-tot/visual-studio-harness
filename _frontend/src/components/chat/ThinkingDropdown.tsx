import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { triggerPill, dropdownPanel, dropdownItem } from "../../styles/shared";

const EFFORTS = ["off", "low", "medium", "high"] as const;

interface ThinkingDropdownProps {
  value: string;
  onChange: (v: string) => void;
}

export function ThinkingDropdown({ value, onChange }: ThinkingDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button data-testid="temp-pill" type="button" onClick={() => setOpen(!open)} className={triggerPill}>
        <span>{value}</span>
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && (
        <div className={`${dropdownPanel} w-32`}>
          <div className="p-1">
            {EFFORTS.map((e) => (
              <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }} className={dropdownItem}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
