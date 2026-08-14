export type AuditSeverity = "critical" | "high" | "medium" | "low" | "info";

export type AuditEffort = "quick" | "moderate" | "significant";

/** Single source of truth for all audit category strings. */
export const AUDIT_CATEGORIES = [
  "implementation_completed",
  "general_audit",
  "code_review",
  "security_audit",
  "performance_audit",
  "architecture_review",
  "dependency_audit",
  "style_consistency",
  "config_audit",
  "memory_leak",
  "race_condition",
  "magic_numbers",
  "dead_code",
  "back_compat",
  "custom",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditAttachment {
  designName?: string;
  specName?: string;
  planName?: string;
  label?: string;
}

export type AssessmentStatus =
  | "implemented_as_expected"
  | "implemented_differently"
  | "not_implemented";

export interface ImplementationAssessment {
  aspectName: string;
  expectedBehavior?: string;
  status: AssessmentStatus;
  actualImplementation?: string;
  fileReferences?: string[];
}

export interface AuditFinding {
  severity: AuditSeverity;
  file?: string;
  line?: number;
  title: string;
  description: string;
  recommendation: string;
  category: string;
  effort?: AuditEffort;
}

export interface AuditMeta {
  id: string;
  title: string;
  auditType: AuditCategory;
  endGoal?: string;
  createdAt: string;
  createdBy: "agent";
  /** Provider displayName that produced the audit (editable in the JSON modal). */
  providerName?: string;
  agentModel?: string;
  scope: "global" | "project" | "session";
  workspaceRoot?: string;
  sessionId?: string;
  summary: string;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  attachments?: AuditAttachment[];
  overallStatus?: "pass" | "partial" | "fail";
  overallAssessment?: string;
  assessments?: ImplementationAssessment[];
}

export interface AuditDocument {
  meta: AuditMeta;
  findings: AuditFinding[];
  rawReport?: string;
}

export type AuditPromptCategory = "general" | "implementation";

export interface AuditPrompt {
  id: string;
  name: string;
  description: string;
  category: AuditPromptCategory;
  auditType: AuditCategory;
  endGoal?: string;
  templateInstructions: string;
  createdAt: string;
  updatedAt: string;
}
