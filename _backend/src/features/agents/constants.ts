import type { AgentSettings, SystemPromptJoiners } from "../../../_shared/types";

export const AGENTS_MD_NAMES = ["agents.md", "AGENTS.md"] as const;

export const DEFAULT_SYSTEM_PROMPT_JOINERS: SystemPromptJoiners = {
  start: "",
  afterGlobal: "\n\n",
  afterAgentMd: "\n\n",
  afterSkillMds: "\n\n",
  afterProject: "\n\n",
  afterRuntime: "\n\n",
  afterTodoList: "\n\n",
  afterExtras: "\n\n",
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
}
