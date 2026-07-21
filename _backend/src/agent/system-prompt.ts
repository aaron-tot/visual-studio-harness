export {
  AGENTS_MD_NAMES,
  DEFAULT_SYSTEM_PROMPT_JOINERS,
  globalAgentsPath,
  projectAgentsPath,
  ensureGlobalAgentsFile,
  listAgentsMdAtRoot,
  formatRuntimeInfo,
  resolveAgentMd,
  resolveSkillMds,
  buildSystemBlock,
  messagesForModel,
  assertExactlyOneSystemMessage,
} from "../features/agents/system-prompt";
export type { BuildSystemBlockInput } from "../features/agents/system-prompt";
