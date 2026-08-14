import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { ResearchEntry } from "../../../../lib/api";
import type { ResearchGroup } from "../../types";
import { EmptyState } from "../ui";
import { ResearchCard } from "./ResearchCard";

interface ResearchGroupListProps {
  flat?: boolean;
  groups: ResearchGroup[];
  loading: boolean;
  error: string | null;
  expandedGroup: string | null;
  expandedDoc: string | null;
  onToggleGroup: (key: string) => void;
  onToggleDoc: (key: string) => void;
  busy: boolean;
  onEditDoc: (name: string, entry: ResearchEntry, location: ResearchGroup["location"]) => void;
  onDeleteDoc: (name: string, location: ResearchGroup["location"]) => void;
}

function DocRows({
  group,
  expandedDoc,
  onToggleDoc,
  busy,
  onEditDoc,
  onDeleteDoc,
}: {
  group: ResearchGroup;
  expandedDoc: string | null;
  onToggleDoc: (key: string) => void;
  busy: boolean;
  onEditDoc: (name: string, entry: ResearchEntry, location: ResearchGroup["location"]) => void;
  onDeleteDoc: (name: string, location: ResearchGroup["location"]) => void;
}) {
  return (
    <>
      {group.docs.map((entry) => {
        const nKey = `${group.key}::${entry.name}`;
        return (
          <ResearchCard
            key={nKey}
            entry={entry}
            expanded={expandedDoc === nKey}
            onToggle={() => onToggleDoc(nKey)}
            busy={busy}
            onEdit={() => onEditDoc(entry.name, entry, group.location)}
            onDelete={() => onDeleteDoc(entry.name, group.location)}
            location={group.location}
          />
        );
      })}
    </>
  );
}

export function ResearchGroupList({
  flat = false,
  groups,
  loading,
  error,
  expandedGroup,
  expandedDoc,
  onToggleGroup,
  onToggleDoc,
  busy,
  onEditDoc,
  onDeleteDoc,
}: ResearchGroupListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const total = groups.reduce((s, g) => s + g.docs.length, 0);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        docs: g.docs.filter(
          (n) =>
            n.document.meta.title.toLowerCase().includes(q) ||
            n.name.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.docs.length > 0 || g.isCurrent);
  }, [groups, searchQuery]);

  if (loading && total === 0) {
    return <EmptyState>Loading...</EmptyState>;
  }
  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }

  const filteredTotal = filteredGroups.reduce((s, g) => s + g.docs.length, 0);

  // Flat global list
  if (flat) {
    if (total === 0) return <EmptyState>No research docs yet</EmptyState>;
    const group = filteredGroups[0];
    if (!group) return <EmptyState>No research docs yet</EmptyState>;
    return (
      <div className="flex-1 py-1">
        <div className="relative mx-3 mb-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
            placeholder="Filter research…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              onClick={() => setSearchQuery("")}
            >
              <X size={11} />
            </button>
          )}
        </div>
        {filteredTotal === 0 ? (
          <EmptyState>No research docs match your filter</EmptyState>
        ) : (
          <DocRows
            group={group}
            expandedDoc={expandedDoc}
            onToggleDoc={onToggleDoc}
            busy={busy}
            onEditDoc={onEditDoc}
            onDeleteDoc={onDeleteDoc}
          />
        )}
      </div>
    );
  }

  // Grouped
  if (groups.length === 0) {
    return <EmptyState>No research docs yet</EmptyState>;
  }

  return (
    <div className="flex-1 py-1">
      <div className="relative mx-3 mb-1">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input
          type="text"
          className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
          placeholder="Filter research…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
            onClick={() => setSearchQuery("")}
          >
            <X size={11} />
          </button>
        )}
      </div>
      {(searchQuery.trim() ? filteredGroups : groups).map((group) => {
        const groupOpen = expandedGroup === group.key;
        return (
          <div key={group.key}>
            <div
              className="flex items-center gap-1 px-3 py-1.5 hover:bg-zinc-900 transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onToggleGroup(group.key);
              }}
              title={
                group.location.workspaceRoot ||
                group.location.sessionId ||
                group.label
              }
            >
              {groupOpen ? (
                <ChevronDown size={12} className="shrink-0 text-zinc-600" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-zinc-600" />
              )}
              <span className="text-[11px] font-semibold text-zinc-400 truncate flex-1">
                {group.label}
              </span>
              {group.isCurrent && (
                <span className="text-[9px] text-emerald-600 shrink-0">(Current)</span>
              )}
              <span className="text-[10px] text-zinc-600 shrink-0">
                {group.docs.length}
              </span>
            </div>
            {groupOpen &&
              (group.docs.length === 0 ? (
                <div className="pl-8 pr-3 py-1 text-[10px] text-zinc-600">
                  No research docs yet — create above to save here
                </div>
              ) : (
                <DocRows
                  group={group}
                  expandedDoc={expandedDoc}
                  onToggleDoc={onToggleDoc}
                  busy={busy}
                  onEditDoc={onEditDoc}
                  onDeleteDoc={onDeleteDoc}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
