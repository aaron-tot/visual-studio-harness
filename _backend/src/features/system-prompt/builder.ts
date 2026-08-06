import type { SystemPromptJoiners } from "../../../_shared/types";
import { ensureGlobalSystemPromptFile } from "../mds";
import {
  DEFAULT_SYSTEM_PROMPT_JOINERS,
  TAG_PRE,
  TAG_POST,
  BASE_SECTION_TAGS,
  VOLATILE_SECTION_TAGS,
  ADDITIONAL_SYSTEM_INFO_TAG,
  ADDITIONAL_SYSTEM_INFO_GUIDANCE,
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
  if (!input.skipSeed) {
    await ensureGlobalSystemPromptFile(input.dataDir, input.mode);
  }
  return buildSystemBlockSections(input);
}

/**
 * Rebuilds the system block WITHOUT seeding the global prompt file.
 * Used by per-step prepareStep rebuilds (seeding happens once per turn).
 * `tags` filters which sections are built (default: all sections — backward compatible).
 */
export async function buildSystemBlockSections(
  input: BuildSystemBlockInput,
  tags: readonly string[] = SECTION_BUILDERS.map((s) => s.tag),
): Promise<string> {
  if (input.noSystemPrompt) return "";

  const joiners = input.systemPromptJoiners ?? DEFAULT_SYSTEM_PROMPT_JOINERS;
  const ctx: SectionContext = {
    dataDir: input.dataDir,
    workspaceRoot: input.workspaceRoot,
    mode: input.mode,
    sessionId: input.sessionId,
    now: input.now,
    turnStart: input.turnStart,
    agentSettings: input.agentSettings,
    workspaceManifest: input.workspaceManifest,
    graphService: input.graphService,
    extras: input.extras,
  };

  const blocks: string[] = [];
  for (const { tag, build } of SECTION_BUILDERS) {
    if (!tags.includes(tag)) continue;
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

/** Stable system sections only — the real `system` message / `instructions`. */
export async function buildSystemBlockBase(input: BuildSystemBlockInput): Promise<string> {
  if (input.noSystemPrompt) return "";
  const block = await buildSystemBlockSections(input, BASE_SECTION_TAGS);
  // Stable guidance line (spec §9 R1) so the model treats the trailing
  // `additional_system_info` injection as context, not a command.
  return block ? `${block}\n\n${ADDITIONAL_SYSTEM_INFO_GUIDANCE}` : ADDITIONAL_SYSTEM_INFO_GUIDANCE;
}

/** Truncates a Date to UTC midnight (day-granularity), matching OpenCode's `<env>` clock. */
function truncateToDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/**
 * Volatile per-request block, wrapped as the trailing `additionalSystemInfo`
 * message content. Returns null when no selected volatile section emits so
 * callers can skip emitting the message entirely (spec §8 empty-resolved ⇒ skip).
 * `sections` filters the volatile tags (usually `additionalSystemInfo.sections`).
 *
 * `includeTime` controls the clock in the volatile block:
 * - false (default): the runtime `datetime` is truncated to day-granularity and
 *   `turn_elapsed` is omitted, so the content only changes when the manifest/todo
 *   sections actually change — the "emit on change" behavior (spec §8.1).
 * - true: full-precision `datetime` + `turn_elapsed`, plus an appended
 *   `<timestamp>` line, so the content ALWAYS differs across steps (each step
 *   emits a new injection).
 */
export async function buildAdditionalSystemInfoBlock(
  input: BuildSystemBlockInput,
  sections: readonly string[] = VOLATILE_SECTION_TAGS,
  includeTime = false,
): Promise<string | null> {
  const volInput: BuildSystemBlockInput = includeTime
    ? input
    : {
        ...input,
        now: truncateToDay(input.now ?? new Date()),
        turnStart: undefined,
      };
  const partial = await buildSystemBlockSections(volInput, sections);
  if (!partial) return null;
  const ts = includeTime ? `\n<timestamp>${new Date().toISOString()}</timestamp>` : "";
  return `<${ADDITIONAL_SYSTEM_INFO_TAG}>\n${partial}${ts}\n</${ADDITIONAL_SYSTEM_INFO_TAG}>`;
}
