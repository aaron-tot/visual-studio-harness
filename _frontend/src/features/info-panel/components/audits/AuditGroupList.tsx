import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { AuditEntry, AuditDocument } from "../../../../lib/api";
import type { AuditGroup, DesignLocation, PlanScope } from "../../types";
import { EmptyState } from "../ui";
import { AuditCard } from "./AuditCard";

interface AuditGroupListProps {
  /** When true, render audits without group headers (global scope). */
  flat?: boolean;
  groups: AuditGroup[];
  loading: boolean;
  error: string | null;
  expandedGroup: string | null;
  expandedAudit: string | null;
  onToggleGroup: (key: string) => void;
  onToggleAudit: (key: string) => void;
  busy: boolean;
  onDelete: (auditName: string, location: AuditGroup["location"]) => void;
  onMove: (auditName: string, location: DesignLocation, toScope: PlanScope) => void;
  onSave?: (auditName: string, document: AuditDocument) => void;
}

function AuditRows({
  group,
  expandedAudit,
  onToggleAudit,
  busy,
  onDelete,
  onMove,
  onSave,
}: {
  group: AuditGroup;
  expandedAudit: string | null;
  onToggleAudit: (key: string) => void;
  busy: boolean;
  onDelete: (auditName: string, location: AuditGroup["location"]) => void;
  onMove: (auditName: string, location: DesignLocation, toScope: PlanScope) => void;
  onSave?: (auditName: string, document: AuditDocument) => void;
}) {
  return (
    <>
      {group.audits.map((audit) => {
        const aKey = `${group.key}::${audit.name}`;
        return (
          <AuditCard
            key={aKey}
            audit={audit}
            expanded={expandedAudit === aKey}
            onToggle={() => onToggleAudit(aKey)}
            busy={busy}
            onDelete={() => onDelete(audit.name, group.location)}
            location={group.location}
            onMove={(toScope) => onMove(audit.name, group.location, toScope)}
            onSave={onSave}
          />
        );
      })}
    </>
  );
}

export function AuditGroupList({
  flat = false,
  groups,
  loading,
  error,
  expandedGroup,
  expandedAudit,
  onToggleGroup,
  onToggleAudit,
  busy,
  onDelete,
  onMove,
  onSave,
}: AuditGroupListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const total = groups.reduce((s, g) => s + g.audits.length, 0);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        audits: g.audits.filter(
          (a) =>
            a.document.meta.title.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            a.document.meta.auditType.toLowerCase().includes(q) ||
            a.document.meta.summary.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.audits.length > 0 || g.isCurrent);
  }, [groups, searchQuery]);

  if (loading && total === 0) {
    return <EmptyState>Loading…</EmptyState>;
  }
  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }

  const filteredTotal = filteredGroups.reduce((s, g) => s + g.audits.length, 0);

  // Flat global list
  if (flat) {
    if (total === 0) return <EmptyState>No audits yet</EmptyState>;
    const group = filteredGroups[0];
    if (!group || group.audits.length === 0) return <EmptyState>No audits yet</EmptyState>;
    return (
      <div className="flex-1 py-1">
        <div className="relative mx-3 mb-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
            placeholder="Filter audits…"
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
          <EmptyState>No audits match your filter</EmptyState>
        ) : (
          <AuditRows
            group={group}
            expandedAudit={expandedAudit}
            onToggleAudit={onToggleAudit}
            busy={busy}
            onDelete={onDelete}
            onMove={onMove}
            onSave={onSave}
          />
        )}
      </div>
    );
  }

  // Grouped
  if (groups.length === 0) {
    return <EmptyState>No audits yet</EmptyState>;
  }

  return (
    <div className="flex-1 py-1">
      <div className="relative mx-3 mb-1">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input
          type="text"
          className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
          placeholder="Filter audits…"
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
                {group.audits.length}
              </span>
            </div>
            {groupOpen &&
              (group.audits.length === 0 ? (
                <div className="pl-8 pr-3 py-1 text-[10px] text-zinc-600">
                  No audits yet for this {group.label}
                </div>
              ) : (
                <AuditRows
                  group={group}
                  expandedAudit={expandedAudit}
                  onToggleAudit={onToggleAudit}
                  busy={busy}
                  onDelete={onDelete}
                  onMove={onMove}
                  onSave={onSave}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
