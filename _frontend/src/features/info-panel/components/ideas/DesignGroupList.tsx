import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { PlanEntry } from "../../../../lib/api";
import type { DesignGroup, DesignLocation, DocMode, InjectSub } from "../../types";
import { planExpandKey } from "../../types";
import { EmptyState } from "../ui";
import { PlanCard } from "./PlanCard";

interface DesignGroupListProps {
  /** When true, render designs without group headers (global scope). */
  flat?: boolean;
  groups: DesignGroup[];
  loading: boolean;
  error: string | null;
  expandedGroup: string | null;
  expandedPlan: string | null;
  onToggleGroup: (key: string) => void;
  onTogglePlan: (key: string) => void;
  busy: boolean;
  abandoningKey: string | null;
  abandonReason: string;
  abandonSuccessor: string;
  onAbandonReason: (v: string) => void;
  onAbandonSuccessor: (v: string) => void;
  onStartAbandon: (planKey: string, planName: string, location: DesignLocation) => void;
  onCancelAbandon: () => void;
  onConfirmAbandon: (planName: string, location: DesignLocation) => void;
  onDelete: (planName: string, location: DesignLocation) => void;
  onArchive: (planName: string, location: DesignLocation) => void;
  onAddVersion: (planName: string, mode: DocMode, location: DesignLocation) => void;
  isInjected: (planName: string, mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (plan: PlanEntry, mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
  onRefresh: () => void;
}

function PlanRows({
  group,
  expandedPlan,
  onTogglePlan,
  busy,
  abandoningKey,
  abandonReason,
  abandonSuccessor,
  onAbandonReason,
  onAbandonSuccessor,
  onStartAbandon,
  onCancelAbandon,
  onConfirmAbandon,
  onDelete,
  onArchive,
  onAddVersion,
  isInjected,
  onToggleInject,
  onResult,
  onRefresh,
  indent,
}: {
  group: DesignGroup;
  expandedPlan: string | null;
  onTogglePlan: (key: string) => void;
  busy: boolean;
  abandoningKey: string | null;
  abandonReason: string;
  abandonSuccessor: string;
  onAbandonReason: (v: string) => void;
  onAbandonSuccessor: (v: string) => void;
  onStartAbandon: (planKey: string, planName: string, location: DesignLocation) => void;
  onCancelAbandon: () => void;
  onConfirmAbandon: (planName: string, location: DesignLocation) => void;
  onDelete: (planName: string, location: DesignLocation) => void;
  onArchive: (planName: string, location: DesignLocation) => void;
  onAddVersion: (planName: string, mode: DocMode, location: DesignLocation) => void;
  isInjected: (planName: string, mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (plan: PlanEntry, mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
  onRefresh: () => void;
  indent: boolean;
}) {
  return (
    <>
      {group.designs.map((plan) => {
        const pKey = planExpandKey(group.key, plan.name);
        return (
          <div key={pKey}>
            <PlanCard
              plan={plan}
              expanded={expandedPlan === pKey}
              flatHeader={!indent}
              onToggle={() => onTogglePlan(pKey)}
              busy={busy}
              abandoning={abandoningKey === pKey}
              abandonReason={abandonReason}
              abandonSuccessor={abandonSuccessor}
              onAbandonReason={onAbandonReason}
              onAbandonSuccessor={onAbandonSuccessor}
              onStartAbandon={() => onStartAbandon(pKey, plan.name, group.location)}
              onCancelAbandon={onCancelAbandon}
              onConfirmAbandon={() => onConfirmAbandon(plan.name, group.location)}
              onDelete={() => onDelete(plan.name, group.location)}
              onArchive={() => onArchive(plan.name, group.location)}
              onAddVersion={(mode) => onAddVersion(plan.name, mode, group.location)}
              isInjected={(mode, sub) => isInjected(plan.name, mode, sub)}
              onToggleInject={(mode, sub) => onToggleInject(plan, mode, sub)}
              onResult={onResult}
              location={group.location}
              onRefresh={onRefresh}
            />
          </div>
        );
      })}
    </>
  );
}

export function DesignGroupList({
  flat = false,
  groups,
  loading,
  error,
  expandedGroup,
  expandedPlan,
  onToggleGroup,
  onTogglePlan,
  busy,
  abandoningKey,
  abandonReason,
  abandonSuccessor,
  onAbandonReason,
  onAbandonSuccessor,
  onStartAbandon,
  onCancelAbandon,
  onConfirmAbandon,
  onDelete,
  onArchive,
  onAddVersion,
  isInjected,
  onToggleInject,
  onResult,
  onRefresh,
}: DesignGroupListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const total = groups.reduce((s, g) => s + g.designs.length, 0);

  // Filter designs by name
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        designs: g.designs.filter((d) => d.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.designs.length > 0 || g.isCurrent);
    // Always keep the current group visible even if empty after filter
  }, [groups, searchQuery]);

  if (loading && total === 0) {
    return <EmptyState>Loading...</EmptyState>;
  }
  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }

  const filteredTotal = filteredGroups.reduce((s, g) => s + g.designs.length, 0);

  // Search bar — always visible (no threshold)
  const showSearch = true;

  // Flat global list
  if (flat) {
    if (total === 0) return <EmptyState>No designs yet</EmptyState>;
    const group = filteredGroups[0];
    if (!group) return <EmptyState>No designs yet</EmptyState>;
    return (
      <div className="flex-1 py-1">
        {showSearch && (
          <div className="relative mx-3 mb-1">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
              placeholder="Filter designs…"
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
        )}
        {filteredTotal === 0 ? (
          <EmptyState>No designs match your filter</EmptyState>
        ) : (
          <PlanRows
          group={group}
          expandedPlan={expandedPlan}
          onTogglePlan={onTogglePlan}
          busy={busy}
          abandoningKey={abandoningKey}
          abandonReason={abandonReason}
          abandonSuccessor={abandonSuccessor}
          onAbandonReason={onAbandonReason}
          onAbandonSuccessor={onAbandonSuccessor}
          onStartAbandon={onStartAbandon}
          onCancelAbandon={onCancelAbandon}
          onConfirmAbandon={onConfirmAbandon}
          onDelete={onDelete}
          onArchive={onArchive}
          onAddVersion={onAddVersion}
          isInjected={isInjected}
          onToggleInject={onToggleInject}
          onResult={onResult}
          onRefresh={onRefresh}
          indent={false}
        />
      )}
      </div>
    );
  }

  // Grouped: still show empty current group so user sees create target
  if (groups.length === 0) {
    return <EmptyState>No designs yet</EmptyState>;
  }

  return (
    <div className="flex-1 py-1">
      {showSearch && (
        <div className="relative mx-3 mb-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            className="w-full text-[10px] bg-zinc-800 text-zinc-300 pl-6 pr-6 py-1 rounded outline-none placeholder-zinc-600"
            placeholder="Filter designs…"
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
      )}
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
                {group.designs.length}
              </span>
            </div>
            {groupOpen &&
              (group.designs.length === 0 ? (
                <div className="pl-8 pr-3 py-1 text-[10px] text-zinc-600">
                  No designs yet — create above to save here
                </div>
              ) : (
                <PlanRows
                  group={group}
                  expandedPlan={expandedPlan}
                  onTogglePlan={onTogglePlan}
                  busy={busy}
                  abandoningKey={abandoningKey}
                  abandonReason={abandonReason}
                  abandonSuccessor={abandonSuccessor}
                  onAbandonReason={onAbandonReason}
                  onAbandonSuccessor={onAbandonSuccessor}
                  onStartAbandon={onStartAbandon}
                  onCancelAbandon={onCancelAbandon}
                  onConfirmAbandon={onConfirmAbandon}
                  onDelete={onDelete}
                  onArchive={onArchive}
                  onAddVersion={onAddVersion}
                  isInjected={isInjected}
                  onToggleInject={onToggleInject}
                  onResult={onResult}
                  onRefresh={onRefresh}
                  indent
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
