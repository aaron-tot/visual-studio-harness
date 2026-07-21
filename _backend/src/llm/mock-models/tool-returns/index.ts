// ═══════════════════════════════════════════════════════════════════════════════
// 🚨 DO NOT MODIFY without explicit user approval. Template format and spacers
//     directly drive generateExpectedText() output. Changing these WILL break
//     the progressive-match regression gate in session-mixed-parts.spec.ts.
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const _filename = fileURLToPath(import.meta.url);
const TEMPLATE_DIR = dirname(_filename);

const cache: Record<string, string> = {};

function load(name: string): string {
  if (!cache[name]) {
    cache[name] = readFileSync(join(TEMPLATE_DIR, name + ".md"), "utf-8").trimEnd();
  }
  return cache[name];
}

export interface ToolCardVars {
  toolName: string;
  argSummary: string;
  argsJson: string;
  result: string;
  statusLabel?: string;
}

function fill(tpl: string, vars: Record<string, string>): string {
  let text = tpl;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll("{" + k + "}", v);
  }
  return text;
}

/** Render a standalone tool card (gets \n\n before/after from the caller). */
export function formatToolCard(vars: ToolCardVars): string {
  const tpl = load("tool-standalone");
  let text = fill(tpl, {
    toolName: vars.toolName,
    argSummary: vars.argSummary,
    argsJson: vars.argsJson,
    result: vars.result,
    statusLabel: vars.statusLabel ?? "COMPLETED",
  });
  if (!vars.result.trim()) {
    text = text.replace(/\n▶\nOutput\n$/, "");
  }
  return text;
}

/** Render a tool card inside a group (no blank lines between group siblings). */
export function formatToolCardInGroup(vars: ToolCardVars): string {
  const tpl = load("tool-in-group");
  let text = fill(tpl, {
    toolName: vars.toolName,
    argSummary: vars.argSummary,
    argsJson: vars.argsJson,
    result: vars.result,
    statusLabel: vars.statusLabel ?? "COMPLETED",
  });
  if (!vars.result.trim()) {
    text = text.replace(/\n▶\nOutput\n$/, "");
  }
  return text;
}

/** Render a context/change group header. */
export function formatToolGroup(label: string, summary: string, toolsContent: string): string {
  const tpl = load("group-header");
  return fill(tpl, { groupLabel: label, groupSummary: summary }) + "\n" + toolsContent;
}

/** Spacing rules – which spacer to use between two section types. */
const SPACING: Record<string, string> = {
  "text-to-tool": "\n\n",
  "tool-to-tool": "\n\n",
  "tool-in-group": "\n",
  "group-to-tool": "\n\n",
  "group-to-text": "\n\n",
  "tool-to-group": "\n",
  "group-end": "\n",
};

export function spacer(from: "text" | "tool" | "group", to: "text" | "tool" | "group"): string {
  const key = from + "-to-" + to;
  return SPACING[key] ?? "\n";
}
