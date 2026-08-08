import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { NoteEntry } from "../../../../lib/api";
import type { DesignLocation, NoteGroup, PlanScope } from "../../types";
import { EmptyState } from "../ui";
import { NoteCard } from "./NoteCard";

interface NoteGroupListProps {
  /** When true, render notes without group headers (global scope). */
  flat?: boolean;
  groups: NoteGroup[];
  loading: boolean;
  error: string | null;
  expandedGroup: string | null;
  expandedNote: string | null;
  onToggleGroup: (key: string) => void;
  onToggleNote: (key: string) => void;
  busy: boolean;
  onEditNote: (noteName: string, note: NoteEntry, location: NoteGroup["location"]) => void;
  onArchive: (noteName: string, location: NoteGroup["location"]) => void;
  onDelete: (noteName: string, location: NoteGroup["location"]) => void;
  onMove: (noteName: string, location: DesignLocation, toScope: PlanScope) => void;
}

function NoteRows({
  group,
  expandedNote,
  onToggleNote,
  busy,
  onEditNote,
  onArchive,
  onDelete,
  onMove,
  indent,
}: {
  group: NoteGroup;
  expandedNote: string | null;
  onToggleNote: (key: string) => void;
  busy: boolean;
  onEditNote: (noteName: string, note: NoteEntry, location: NoteGroup["location"]) => void;
  onArchive: (noteName: string, location: NoteGroup["location"]) => void;
  onDelete: (noteName: string, location: NoteGroup["location"]) => void;
  onMove: (noteName: string, location: DesignLocation, toScope: PlanScope) => void;
  indent: boolean;
}) {
  return (
    <>
      {group.notes.map((note) => {
        const nKey = `${group.key}::${note.name}`;
        return (
          <NoteCard
            key={nKey}
            note={note}
            expanded={expandedNote === nKey}
            onToggle={() => onToggleNote(nKey)}
            busy={busy}
            onEdit={() => onEditNote(note.name, note, group.location)}
            onArchive={() => onArchive(note.name, group.location)}
            onDelete={() => onDelete(note.name, group.location)}
            location={group.location}
            onMove={(toScope) => onMove(note.name, group.location, toScope)}
          />
        );
      })}
    </>
  );
}

export function NoteGroupList({
  flat = false,
  groups,
  loading,
  error,
  expandedGroup,
  expandedNote,
  onToggleGroup,
  onToggleNote,
  busy,
  onEditNote,
  onArchive,
  onDelete,
  onMove,
}: NoteGroupListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const total = groups.reduce((s, g) => s + g.notes.length, 0);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        notes: g.notes.filter(
          (n) => n.title.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.notes.length > 0 || g.isCurrent);
  }, [groups, searchQuery]);

  if (loading && total === 0) {
    return <EmptyState>Loading...</EmptyState>;
  }
  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }

  const filteredTotal = filteredGroups.reduce((s, g) => s + g.notes.length, 0);

  // Flat global list
  if (flat) {
    if (total === 0) return <EmptyState>No notes yet</EmptyState>;
    const group = filteredGroups[0];
    if (!group) return <EmptyState>No notes yet</EmptyState>;
    return (
      <div className="flex-1 py-1">
        <div className="relative mx-3 mb-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
            placeholder="Filter notes…"
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
          <EmptyState>No notes match your filter</EmptyState>
        ) : (
          <NoteRows
            group={group}
            expandedNote={expandedNote}
            onToggleNote={onToggleNote}
            busy={busy}
            onEditNote={onEditNote}
            onArchive={onArchive}
            onDelete={onDelete}
            onMove={onMove}
            indent={false}
          />
        )}
      </div>
    );
  }

  // Grouped
  if (groups.length === 0) {
    return <EmptyState>No notes yet</EmptyState>;
  }

  return (
    <div className="flex-1 py-1">
      <div className="relative mx-3 mb-1">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input
          type="text"
          className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
          placeholder="Filter notes…"
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
                {group.notes.length}
              </span>
            </div>
            {groupOpen &&
              (group.notes.length === 0 ? (
                <div className="pl-8 pr-3 py-1 text-[10px] text-zinc-600">
                  No notes yet — create above to save here
                </div>
              ) : (
                <NoteRows
                  group={group}
                  expandedNote={expandedNote}
                  onToggleNote={onToggleNote}
                  busy={busy}
                  onEditNote={onEditNote}
                  onArchive={onArchive}
                  onDelete={onDelete}
                  onMove={onMove}
                  indent
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
