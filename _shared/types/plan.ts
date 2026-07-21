export type PartStatus = "planned" | "ready" | "in_progress" | "blocked" | "waiting" | "review" | "completed" | "failed" | "abandoned" | "redundant" | "cancelled" | "deferred";
export type PartType = "phase" | "milestone" | "task" | "research" | "design" | "implementation" | "testing" | "review" | "decision" | "documentation" | "deployment" | "custom";
export type DocStatus = "draft" | "active" | "paused" | "completed" | "cancelled" | "archived";
export type CreatedBy = "user" | "agent";

export interface ExecutionConfig {
  useSubAgents?: boolean;
  parallel?: boolean;
  preferredAgent?: string;
  maxAgents?: number;
}

export interface CreatedMeta {
  datetime: string;
  workspace: string;
  session: string;
}

export interface SpecPlanPart {
  id: string;
  name: string;
  type: PartType;
  description?: string;
  status: PartStatus;
  priority?: "low" | "medium" | "high";
  dependsOn?: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  execution?: ExecutionConfig;
  artifacts?: string[];
  notes?: string[];
  parts: SpecPlanPart[];
}

export interface SpecMeta {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: CreatedBy;
  updatedBy?: CreatedBy;
  status: DocStatus;
  relatedSpecs: string[];
  createdMeta: CreatedMeta;
}

export interface SpecDocument {
  meta: SpecMeta;
  goal: string;
  requirements: string[];
  constraints: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  parts: SpecPlanPart[];
}

export interface PlanMeta {
  id: string;
  version: number;
  mainSpec: string;
  relatedSpecs: string[];
  title: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy: CreatedBy;
  updatedBy?: CreatedBy;
  status: DocStatus;
  tags: string[];
  createdMeta: CreatedMeta;
}

export interface PlanDocument {
  meta: PlanMeta;
  endGoal: string;
  parts: SpecPlanPart[];
}
