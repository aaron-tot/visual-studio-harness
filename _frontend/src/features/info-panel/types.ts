import type { AuditEntry, NoteEntry, PlanEntry, ResearchEntry } from "../../lib/api";

export type { PlanEntry, ResearchEntry };

/** Live Usage tree (former Usage V2). */
export type InfoPanelTab = "usage" | "designs" | "notepad" | "audits" | "research" | "graph" | "knowledge";
export type PlanScope = "global" | "project" | "session";
export type DocMode = "spec" | "plan";
export type InjectSub = "full" | "path";

/** Where an idea lives for API calls (create / mutate). */
export interface DesignLocation {
  scope: PlanScope;
  workspaceRoot?: string;
  sessionId?: string;
}

export interface DesignGroup {
  /** Stable unique key for expand state */
  key: string;
  label: string;
  isCurrent: boolean;
  designs: PlanEntry[];
  /** Location used for mutations on designs in this group */
  location: DesignLocation;
}

export interface NoteGroup {
  /** Stable unique key for expand state */
  key: string;
  label: string;
  isCurrent: boolean;
  notes: NoteEntry[];
  /** Location used for mutations on notes in this group */
  location: DesignLocation;
}

export interface AuditGroup {
  /** Stable unique key for expand state */
  key: string;
  label: string;
  isCurrent: boolean;
  audits: AuditEntry[];
  /** Location used for mutations on audits in this group */
  location: DesignLocation;
}

export interface ResearchGroup {
  /** Stable unique key for expand state */
  key: string;
  label: string;
  isCurrent: boolean;
  docs: ResearchEntry[];
  /** Location used for mutations on research in this group */
  location: DesignLocation;
}

export interface ScopeQuery {
  scope: PlanScope;
  workspaceRoot?: string | null;
  sessionId?: string | null;
}

export function injectKey(planName: string, mode: DocMode, sub: InjectSub): string {
  return `${planName}:${mode}:${sub}`;
}

export function planExpandKey(groupKey: string, planName: string): string {
  return `${groupKey}::${planName}`;
}

/** Short label for a workspace path */
export function workspaceLabel(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts[parts.length - 1] || root;
}
