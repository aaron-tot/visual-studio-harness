import type { AgentSettings, SystemPromptJoiners, WorkspaceManifestSettings } from "../../../_shared/types";
import type { WorkspaceGraphService } from "../../core/workspaceGraph/api/types";

export const AGENTS_MD_NAMES = ["agents.md", "AGENTS.md"] as const;

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
  extras?: string[];
  agentSettings?: AgentSettings;
  noSystemPrompt?: boolean;
  systemPromptJoiners?: SystemPromptJoiners;
  workspaceManifest?: WorkspaceManifestSettings;
  graphService?: WorkspaceGraphService;
}
