import type { SystemPromptJoiners } from "../../../_shared/types";
import { ensureGlobalAgentsFile } from "../agents/system-prompt";
import {
  DEFAULT_SYSTEM_PROMPT_JOINERS,
  TAG_PRE,
  TAG_POST,
  type BuildSystemBlockInput,
  type JoinerKey,
} from "./constants";
import type { SectionContext } from "./sections/types";
import {
  buildGlobalSection,
  buildAgentMdSection,
  buildSkillsSection,
  buildProjectSection,
  buildRuntimeSection,
  buildTodoListSection,
  buildWorkspaceManifestSection,
  buildExtrasSection,
} from "./sections";

function wrapWithJoiners(content: string, tag: string, joiners: SystemPromptJoiners): string {
  const pre = joiners[TAG_PRE[tag]] ?? `<${tag}>`;
  const post = joiners[TAG_POST[tag]] ?? `</${tag}>`;
  return `${pre}\n${content}\n${post}`;
}

const SECTION_BUILDERS: Array<{ tag: string; build: (ctx: SectionContext) => Promise<string | null> }> = [
  { tag: "global", build: buildGlobalSection },
  { tag: "agent", build: buildAgentMdSection },
  { tag: "skills", build: buildSkillsSection },
  { tag: "project", build: buildProjectSection },
  { tag: "runtime", build: buildRuntimeSection },
  { tag: "todoList", build: buildTodoListSection },
  { tag: "workspaceManifest", build: buildWorkspaceManifestSection },
  { tag: "extras", build: buildExtrasSection },
];

export async function buildSystemBlock(input: BuildSystemBlockInput): Promise<string> {
  if (input.noSystemPrompt) return "";
  await ensureGlobalAgentsFile(input.dataDir, input.mode);

  const joiners = input.systemPromptJoiners ?? DEFAULT_SYSTEM_PROMPT_JOINERS;
  const ctx: SectionContext = {
    dataDir: input.dataDir,
    workspaceRoot: input.workspaceRoot,
    mode: input.mode,
    sessionId: input.sessionId,
    now: input.now,
    agentSettings: input.agentSettings,
    workspaceManifest: input.workspaceManifest,
    graphService: input.graphService,
    extras: input.extras,
  };

  const blocks: string[] = [];
  for (const { tag, build } of SECTION_BUILDERS) {
    try {
      const content = await build(ctx);
      if (content) {
        blocks.push(wrapWithJoiners(content, tag, joiners));
      }
    } catch (e) {
      console.error(`[buildSystemBlock] error in section "${tag}":`, e);
    }
  }

  return blocks.join("\n\n");
}