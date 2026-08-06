import type { SectionContext } from "./types";
import { resolveSkillMds } from "../../mds";

export async function buildSkillsSection(ctx: SectionContext): Promise<string | null> {
  if (!ctx.agentSettings?.skillMds?.length) return null;

  // Group skills by attachment mode
  const byMode: Record<string, Array<{ config: typeof ctx.agentSettings.skillMds[0]; content: string }>> = {
    inject: [],
    hard: [],
    soft: [],
  };

  for (const skill of ctx.agentSettings.skillMds) {
    const mode = skill.attachmentMode ?? "inject";
    const contents = await resolveSkillMds([skill], {
      dataDir: ctx.dataDir,
      workspaceRoot: ctx.workspaceRoot,
      sessionId: ctx.sessionId,
    });
    if (contents.length > 0) {
      byMode[mode].push({ config: skill, content: contents[0] });
    }
  }

  const sections: string[] = [];

  // Injected skills — always active in system prompt
  if (byMode.inject.length > 0) {
    sections.push("### Injected Skills (always active)");
    sections.push("The following skills are injected into your system prompt and always active:");
    sections.push("");
    for (const { config, content } of byMode.inject) {
      const label = config.name ?? config.path ?? "unnamed";
      sections.push(`- **${label}** — always active`);
    }
    sections.push("");
  }

  // Hard skills — must read before related tasks
  if (byMode.hard.length > 0) {
    sections.push("### Hard Skills (must read before related tasks)");
    sections.push("**IMPORTANT:** You MUST read the following skills via the `skill` tool BEFORE starting any related task. Do not proceed without reading them first.");
    sections.push("");
    for (const { config, content } of byMode.hard) {
      const label = config.name ?? config.path ?? "unnamed";
      const tagStr = config.tag ? ` (tag: ${config.tag})` : "";
      sections.push(`- **${label}**${tagStr}`);
    }
    sections.push("");
  }

  // Soft skills — optional reference
  if (byMode.soft.length > 0) {
    sections.push("### Soft Skills (reference — use skill tool when relevant)");
    sections.push("The following skills are available as reference material. Use the `skill` tool to read them when relevant to your current task.");
    sections.push("");
    for (const { config, content } of byMode.soft) {
      const label = config.name ?? config.path ?? "unnamed";
      const tagStr = config.tag ? ` (tag: ${config.tag})` : "";
      sections.push(`- **${label}**${tagStr}`);
    }
    sections.push("");
  }

  // If only injected skills, return the traditional concatenated content for backward compat
  if (byMode.hard.length === 0 && byMode.soft.length === 0) {
    const injectedContent = byMode.inject.map(({ content }) => content).join("\n\n");
    return injectedContent;
  }

  return sections.join("\n");
}
