import type { AgentSettings, SystemPromptJoiners, WorkspaceManifestSettings } from "../../../_shared/types";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";

export const DEFAULT_SYSTEM_PROMPT_JOINERS: SystemPromptJoiners = {
  start: "",
  preGlobal: "<global>",
  postGlobal: "</global>",
  preAgent: "<agent>",
  postAgent: "</agent>",
  preSkills: "<skills>",
  postSkills: "</skills>",
  preProject: "<project>",
  postProject: "</project>",
  preRuntime: "<runtime>",
  postRuntime: "</runtime>",
  preTodoList: "<todoList>",
  postTodoList: "</todoList>",
  preWorkspaceManifest: "<workspaceManifest>",
  postWorkspaceManifest: "</workspaceManifest>",
  preExtras: "<extras>",
  postExtras: "</extras>",
  end: "",
};

export interface BuildSystemBlockInput {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  sessionId?: string;
  now?: Date;
  /** Turn start timestamp; renders `- turn_elapsed:` in the runtime block. */
  turnStart?: Date;
  extras?: string[];
  agentSettings?: AgentSettings;
  noSystemPrompt?: boolean;
  systemPromptJoiners?: SystemPromptJoiners;
  workspaceManifest?: WorkspaceManifestSettings;
  graphService?: WorkspaceGraphService;
  /** When true, skip ensureGlobalSystemPromptFile seeding (caller already seeded once per turn). */
  skipSeed?: boolean;
}

export type JoinerKey = keyof SystemPromptJoiners;

export const TAG_PRE: Record<string, JoinerKey> = {
  global: "preGlobal",
  agent: "preAgent",
  skills: "preSkills",
  project: "preProject",
  runtime: "preRuntime",
  todoList: "preTodoList",
  workspaceManifest: "preWorkspaceManifest",
  extras: "preExtras",
};

export const TAG_POST: Record<string, JoinerKey> = {
  global: "postGlobal",
  agent: "postAgent",
  skills: "postSkills",
  project: "postProject",
  runtime: "postRuntime",
  todoList: "postTodoList",
  workspaceManifest: "postWorkspaceManifest",
  extras: "postExtras",
};
