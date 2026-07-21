import { resolve } from "node:path";
import { globalAgentsPath } from "./paths";
import { readAgentsFile, readAgentsFromRoot, resolveAgentMd, resolveSkillMds } from "./md-utils";
import { formatRuntimeInfo } from "./format";
import { formatTodoList } from "./todo-list-format";
import { DEFAULT_SYSTEM_PROMPT_JOINERS, type BuildSystemBlockInput } from "./constants";
import { ensureGlobalAgentsFile } from "./system-prompt";

const SLOT_TAGS = ["global", "agent", "skills", "project", "runtime", "todoList", "extras"] as const;

function wrapTag(content: string, tag: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

export async function buildSystemBlock(input: BuildSystemBlockInput): Promise<string> {
  if (input.noSystemPrompt) return "";
  await ensureGlobalAgentsFile(input.dataDir, input.mode);
  const joiners = input.systemPromptJoiners ?? DEFAULT_SYSTEM_PROMPT_JOINERS;
  const presentBlocks: Array<{ content: string; after: string }> = [];

  const globalFile = globalAgentsPath(input.dataDir);
  const globalText = await readAgentsFile(globalFile);
  if (globalText) presentBlocks.push({ content: wrapTag(globalText, SLOT_TAGS[0]), after: joiners.afterGlobal });

  if (input.agentSettings) {
    const agentMdContent = await resolveAgentMd(input.agentSettings.agentMd);
    if (agentMdContent) presentBlocks.push({ content: wrapTag(agentMdContent, SLOT_TAGS[1]), after: joiners.afterAgentMd });
  }

  if (input.agentSettings) {
    const skillContents = await resolveSkillMds(input.agentSettings.skillMds);
    for (const skillContent of skillContents) presentBlocks.push({ content: wrapTag(skillContent, SLOT_TAGS[2]), after: joiners.afterSkillMds });
  }

  const projectText = await readAgentsFromRoot(input.workspaceRoot);
  if (projectText) presentBlocks.push({ content: wrapTag(projectText, SLOT_TAGS[3]), after: joiners.afterProject });

  const runtimeText = formatRuntimeInfo({ dataDir: input.dataDir, workspaceRoot: resolve(input.workspaceRoot), mode: input.mode, sessionId: input.sessionId, now: input.now });
  presentBlocks.push({ content: wrapTag(runtimeText, SLOT_TAGS[4]), after: joiners.afterRuntime });

  const todoListText = await formatTodoList(input.sessionId, input.dataDir);
  if (todoListText) presentBlocks.push({ content: wrapTag(todoListText, SLOT_TAGS[5]), after: joiners.afterTodoList });

  for (const extra of input.extras ?? []) {
    const t = extra.trim();
    if (t) presentBlocks.push({ content: wrapTag(t, SLOT_TAGS[6]), after: joiners.afterExtras });
  }

  let result = joiners.start;
  for (let i = 0; i < presentBlocks.length; i++) {
    result += presentBlocks[i].content;
    result += presentBlocks[i].after;
  }
  result += joiners.end;
  return result;
}
