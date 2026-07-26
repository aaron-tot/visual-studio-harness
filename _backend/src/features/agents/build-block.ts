import { resolve } from "node:path";
import { globalAgentsPath } from "./paths";
import { readAgentsFile, readAgentsFromRoot, resolveAgentMd, resolveSkillMds } from "./md-utils";
import { formatRuntimeInfo } from "./format";
import { formatTodoList } from "./todo-list-format";
import { DEFAULT_SYSTEM_PROMPT_JOINERS, type BuildSystemBlockInput } from "./constants";
import type { SystemPromptJoiners } from "../../../_shared/types/config";
import { ensureGlobalAgentsFile } from "./system-prompt";
import { buildWorkspaceManifestContext } from "../../core/workspaceGraph/prompt/manifest-context";

const SLOT_TAGS = ["global", "agent", "skills", "project", "runtime", "todoList", "workspaceManifest", "extras"] as const;

type JoinerKey = "preGlobal" | "postGlobal" | "preAgent" | "postAgent" | "preSkills" | "postSkills" | "preProject" | "postProject" | "preRuntime" | "postRuntime" | "preTodoList" | "postTodoList" | "preWorkspaceManifest" | "postWorkspaceManifest" | "preExtras" | "postExtras";

const TAG_PRE: Record<string, JoinerKey> = {
  global: "preGlobal",
  agent: "preAgent",
  skills: "preSkills",
  project: "preProject",
  runtime: "preRuntime",
  todoList: "preTodoList",
  workspaceManifest: "preWorkspaceManifest",
  extras: "preExtras",
};

const TAG_POST: Record<string, JoinerKey> = {
  global: "postGlobal",
  agent: "postAgent",
  skills: "postSkills",
  project: "postProject",
  runtime: "postRuntime",
  todoList: "postTodoList",
  workspaceManifest: "postWorkspaceManifest",
  extras: "postExtras",
};

function wrapWithJoiners(content: string, tag: string, joiners: SystemPromptJoiners): string {
  const pre = joiners[TAG_PRE[tag]] ?? `<${tag}>`;
  const post = joiners[TAG_POST[tag]] ?? `</${tag}>`;
  return `${pre}\n${content}\n${post}`;
}

export async function buildSystemBlock(input: BuildSystemBlockInput): Promise<string> {
  if (input.noSystemPrompt) return "";
  await ensureGlobalAgentsFile(input.dataDir, input.mode);
  const joiners = input.systemPromptJoiners ?? DEFAULT_SYSTEM_PROMPT_JOINERS;
  const presentBlocks: string[] = [];

  const globalFile = globalAgentsPath(input.dataDir);
  const globalText = await readAgentsFile(globalFile);
  if (globalText) presentBlocks.push(wrapWithJoiners(globalText, SLOT_TAGS[0], joiners));

  if (input.agentSettings) {
    const agentMdContent = await resolveAgentMd(input.agentSettings.agentMd);
    if (agentMdContent) presentBlocks.push(wrapWithJoiners(agentMdContent, SLOT_TAGS[1], joiners));
  }

  if (input.agentSettings) {
    const skillContents = await resolveSkillMds(input.agentSettings.skillMds);
    for (const skillContent of skillContents) presentBlocks.push(wrapWithJoiners(skillContent, SLOT_TAGS[2], joiners));
  }

  const projectText = await readAgentsFromRoot(input.workspaceRoot);
  if (projectText) presentBlocks.push(wrapWithJoiners(projectText, SLOT_TAGS[3], joiners));

  const runtimeText = formatRuntimeInfo({ dataDir: input.dataDir, workspaceRoot: resolve(input.workspaceRoot), mode: input.mode, sessionId: input.sessionId, now: input.now });
  presentBlocks.push(wrapWithJoiners(runtimeText, SLOT_TAGS[4], joiners));

  const todoListText = await formatTodoList(input.sessionId, input.dataDir);
  if (todoListText) presentBlocks.push(wrapWithJoiners(todoListText, SLOT_TAGS[5], joiners));

  if (input.workspaceManifest && input.workspaceManifest.enabled && input.graphService) {
    const manifestText = await buildWorkspaceManifestContext({
      config: input.workspaceManifest,
      graph: input.graphService,
      agentId: input.agentSettings?.name,
    });
    if (manifestText) {
      const prefix = input.workspaceManifest.prefix ?? "## Workspace Manifest\n\n";
      const postfix = input.workspaceManifest.postfix ?? "";
      presentBlocks.push(wrapWithJoiners(prefix + manifestText + postfix, SLOT_TAGS[6], joiners));
    }
  }

  for (const extra of input.extras ?? []) {
    const t = extra.trim();
    if (t) presentBlocks.push(wrapWithJoiners(t, SLOT_TAGS[7], joiners));
  }

  let result = "";
  for (let i = 0; i < presentBlocks.length; i++) {
    if (i > 0) result += "\n\n";
    result += presentBlocks[i];
  }
  return result;
}
