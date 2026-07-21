/**
 * AgentSelector
 *
 * Quick-select which agent to invoke, shown as a colored pill in the prompt bar.
 * Displays as a compact pill when an agent is selected, or a "+" button to open
 * the dropdown. Each agent entry is colored with its auto-generated accent color.
 *
 * Keyboard: @ opens the dropdown, Escape closes it, arrow keys navigate,
 * Enter selects, Backspace on empty input deselects.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, X, Search } from "lucide-react";
import { generateAgentColors, getAgentInitial } from "../agents/agent-colors";
import { useConfigStore } from "../../../stores/config";
import { cn } from "../../../lib/utils";
import { triggerPillCompact, dropdownPanel, dropdownSearch, dropdownSearchInput, dropdownSearchBar, dropdownItem, dropdownItemSelected, dropdownItemActive, dropdownHeader } from "../../../styles/shared";

/** Represents an available agent */
export interface AgentOption {
  id: string;
  name: string;
  description?: string;
}

interface AgentSelectorProps {
  agents: AgentOption[];
  selectedAgent: AgentOption | null;
  onSelect: (agent: AgentOption | null) => void;
  className?: string;
  triggerClassName?: string;
}

export function AgentSelector({ agents, selectedAgent, onSelect, className, triggerClassName }: AgentSelectorProps) {
  const { config } = useConfigStore();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // @ mention: open dropdown when user types @ in the chat input
  useEffect(() => {
    if (agents.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      // Only trigger if no dropdown is open and focus is on an input/textarea
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isInput && e.key === "@" && !open) {
        // Check if the input is empty or cursor is at start / after whitespace
        const val = (target as HTMLInputElement | HTMLTextAreaElement).value;
        const pos = (target as HTMLInputElement | HTMLTextAreaElement).selectionStart ?? 0;
        const before = val.slice(0, pos);
        if (before.length === 0 || before.endsWith(" ")) {
          e.preventDefault();
          setOpen(true);
          setActiveIndex(0);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [agents.length, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, agents.length)); // +1 for "None" option
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex === 0) {
            onSelect(null);
          } else {
            onSelect(agents[activeIndex - 1]);
          }
          setOpen(false);
          break;
      }
    },
    [open, activeIndex, agents, onSelect],
  );

  // Reset active index and query when dropdown opens
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      searchRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [open]);

  // Compact pill when agent is selected and dropdown is closed
  if (selectedAgent && !open) {
    const overrideColor = config.agents?.[selectedAgent.name]?.color;
    const colors = generateAgentColors(selectedAgent.name, overrideColor);
    return (
      <div className={cn("relative", className)} ref={dropdownRef}>
        <button
          data-testid="agent-pill"
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" || e.key === "Delete") {
              onSelect(null);
            }
          }}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80",
            triggerClassName,
          )}
          style={triggerClassName ? undefined : {
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
          }}
        >
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
            style={{ backgroundColor: colors.border, color: "white" }}
          >
            {getAgentInitial(selectedAgent.name)}
          </span>
          {selectedAgent.name}
          <ChevronDown size={10} className="opacity-60" />
        </button>
      </div>
    );
  }

  // Dropdown mode
  return (
    <div className={cn("relative", className)} ref={dropdownRef} onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      {!selectedAgent && (
        <button
          data-testid="agent-pill"
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(triggerPillCompact, triggerClassName)}
        >
          <span className={triggerClassName ? undefined : "text-[10px]"}>Default (no system prompt)</span>
          <ChevronDown size={10} />
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div className={`${dropdownPanel} w-64`}>
          <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">Select Agent</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X size={12} />
            </button>
          </div>

          <div className={dropdownSearchBar}>
            <div className={dropdownSearch}>
              <Search size={12} className="text-zinc-500 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents..."
                className={dropdownSearchInput}
              />
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto p-1" role="listbox">
            {/* None option */}
            {query === "" && (
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === 0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(null);
                  setOpen(false);
                }}
                className={cn(
                  dropdownItem,
                  activeIndex === 0 ? dropdownItemSelected : "text-zinc-400",
                )}
              >
                Default (no system prompt)
              </button>
            )}

            {agents.filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase())).map((agent, i) => {
              const overrideColor = config.agents?.[agent.name]?.color;
              const colors = generateAgentColors(agent.name, overrideColor);
              const isSelected = selectedAgent?.id === agent.id;
              const isActive = activeIndex === i + 1;
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { onSelect(agent); setOpen(false); }}
                  className={cn(
                    `${dropdownItem} flex items-center gap-2`,
                    isActive ? dropdownItemActive : isSelected ? "text-white bg-zinc-800/50" : "",
                  )}
                  style={isActive ? { backgroundColor: colors.border } : isSelected ? { backgroundColor: `${colors.border}80` } : undefined}
                >
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold shrink-0"
                    style={{
                      backgroundColor: colors.bg,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    {getAgentInitial(agent.name)}
                  </span>
                  <span className="truncate">{agent.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
