// ═══════════════════════════════════════════════════════════════════════════════
// 🚨 DO NOT MODIFY THIS FILE without explicit user approval. It is the core of
//     the mock-model system used by the session-mixed-parts e2e regression gate.
//     - executeTool() outputs must match frontend rendering exactly
//     - argSummarySingle() must mirror the frontend's getArgSummary()
//     - generateExpectedText() drives the progressive-match expected string
//     - template tool-returns/*.md must match ToolCallCard/ContextToolGroup DOM
//     Changing any of these WILL produce expected text that diverges from the
//     real body text, breaking the "nothing in front, nothing inside" check.
// ═══════════════════════════════════════════════════════════════════════════════

import type { AsyncGenerator } from "../../../../_shared/types";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { formatToolCard, formatToolGroup } from "./tool-returns/index";

export const TEST_RESPONSE = "Hello this is a test. not from a llm";

// ── Helpers ───────────────────────────────────────────────────────────────

export function genCountText(prefix: string, max: number): string {
  const tokens: string[] = [];
  for (let i = 1; i <= max; i++) {
    tokens.push(i === 1 ? `${prefix}${i}` : ` ${prefix}${i}`);
  }
  return tokens.join("");
}

export function resolvePath(p: string, workspaceRoot?: string): string {
  if (!workspaceRoot || p.startsWith("/")) return p;
  return resolve(workspaceRoot, p);
}

const CONTEXT_TOOLS = new Set(["read", "glob", "grep", "find_symbol", "read_symbol"]);
const CHANGE_TOOLS = new Set(["write", "edit", "apply_patch"]);

function toolCategory(name: string): "context" | "changes" | null {
  if (CONTEXT_TOOLS.has(name)) return "context";
  if (CHANGE_TOOLS.has(name)) return "changes";
  return null;
}

function groupSummary(actions: MockAction[]): string {
  const counts: Record<string, number> = {};
  for (const a of actions) {
    if (a.type === "tool") {
      const name = a.toolName;
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  return Object.entries(counts).map(([n, c]) => `${c} ${n}${c !== 1 ? "s" : ""}`).join(", ");
}

function toolBlock(action: MockAction, workspaceRoot?: string): string {
  if (action.type !== "tool") return "";
  const toolResult = executeTool(action.toolName, action.args, workspaceRoot);
  const r = toolResult != null ? String(toolResult).trim() : "";
  const argJson = JSON.stringify(action.args, null, 2);
  const summary = argSummarySingle(action.toolName, action.args);
  return formatToolCard({
    toolName: action.toolName,
    argSummary: summary,
    argsJson: argJson,
    result: r,
  });
}

function argSummarySingle(toolName: string, args: Record<string, unknown>): string {
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case "read": return String(a.path ?? "");
    case "glob": return String(a.pattern ?? "");
    case "grep": return "/" + (a.pattern ?? "") + "/";
    case "write": return String(a.path ?? "");
    case "edit": return String(a.path ?? "");
    case "bash": return String(a.command ?? "").slice(0, 80);
    case "apply_patch": {
      const path = a.path;
      const patchText = String(a.patchText ?? "");
      const preview = patchText.split("\n")[0] + "…";
      return String((path ?? patchText) ? preview : "");
    }
    case "find_symbol": return String(a.query ?? "");
    case "read_symbol": return String(a.name ?? "");
    default: return "";
  }
}

// ── Action types ──────────────────────────────────────────────────────────

export interface TextAction {
  type: "text";
  prefix: string;
  count: number;
}

export interface ToolAction {
  type: "tool";
  toolName: string;
  args: Record<string, unknown>;
}

export interface ThinkingAction {
  type: "thinking";
  words: string[];
}

export type MockAction = TextAction | ToolAction | ThinkingAction;

// ── Streaming: execute actions → yield events ─────────────────────────────

export async function* executeActions(
  actions: MockAction[],
  speed: number,
  signal?: AbortSignal,
  workspaceRoot?: string,
): AsyncGenerator<any> {
  let firstTokenEmitted = false;
  console.log(`[mock-model] Starting executeActions with ${actions.length} actions`);
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
    const action = actions[actionIndex];
    console.log(`[mock-model] >>> Starting action ${actionIndex + 1}/${actions.length}:`, action.type, action.type === "tool" ? action.toolName : action.type === "text" ? action.prefix : "");
    switch (action.type) {
      case "text": {
        for (let i = 1; i <= action.count; i++) {
          if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
          const token = `${action.prefix}${i}`;
          const chunk = firstTokenEmitted ? ` ${token}` : token;
          firstTokenEmitted = true;
          yield { type: "text-delta", text: chunk, delta: chunk };
          await new Promise((r) => setTimeout(r, speed));
        }
        break;
      }
      case "tool": {
        const toolCallId = `mock-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        yield { type: "tool-call", toolCallId, toolName: action.toolName, args: action.args };
        await new Promise((r) => setTimeout(r, speed * 5));
        const realResult = executeTool(action.toolName, action.args, workspaceRoot);
        yield { type: "tool-result", toolCallId, toolName: action.toolName, output: realResult };
        break;
      }
      case "thinking": {
        for (const w of action.words) {
          if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
          yield { type: "reasoning-delta", text: w, delta: w };
          await new Promise((r) => setTimeout(r, speed));
        }
        break;
      }
    }
    console.log(`[mock-model] <<< Finished action ${actionIndex + 1}/${actions.length}, continuing...`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[mock-model] All actions completed`);
}

// ── Expected text: generate the human-readable final output ────────────────

/** Execute a tool against the real filesystem to get its actual result. */
function executeTool(toolName: string, args: Record<string, unknown>, workspaceRoot?: string): unknown {
  switch (toolName) {
    case "bash": {
      const cmd = String(args.command || "");
      try {
        return execSync(cmd, { encoding: "utf-8", timeout: 5000 });
      } catch {
        return "(error)";
      }
    }
    case "write": {
      const p = resolvePath(String(args.path || ""), workspaceRoot);
      const content = String(args.content || "");
      try {
        writeFileSync(p, content, "utf-8");
        return null;
      } catch {
        return null;
      }
    }
    case "read": {
      const p = resolvePath(String(args.path || ""), workspaceRoot);
      try {
        return readFileSync(p, "utf-8");
      } catch {
        return "(file not found)";
      }
    }
    case "edit": {
      const p = resolvePath(String(args.path || ""), workspaceRoot);
      const oldStr = String(args.oldString ?? "");
      const newStr = String(args.newString ?? "");
      try {
        let content = readFileSync(p, "utf-8");
        if (oldStr && content.includes(oldStr)) {
          content = content.replace(oldStr, newStr);
          writeFileSync(p, content, "utf-8");
          return `Replaced "${oldStr}" → "${newStr}" in ${args.path}`;
        }
        return `(no match for "${oldStr}" in ${args.path})`;
      } catch {
        return "(file not found)";
      }
    }
    case "grep": {
      try {
        const pattern = String(args.pattern || "");
        const searchPath = args.path ? resolvePath(String(args.path), workspaceRoot) : workspaceRoot || ".";
        const out = execSync(`grep -rn "${pattern}" "${searchPath}" 2>/dev/null | head -20 || echo "(no matches)"`, { encoding: "utf-8", timeout: 5000 });
        return out.trim();
      } catch {
        return "(no matches)";
      }
    }
    case "glob": {
      try {
        const pattern = String(args.pattern || "*");
        const out = execSync(`find "${workspaceRoot || "."}" -name "${pattern}" -type f 2>/dev/null | head -20 || echo "(no matches)"`, { encoding: "utf-8", timeout: 5000 });
        return out.trim();
      } catch {
        return "(no matches)";
      }
    }
    case "apply_patch": {
      const p = resolvePath(String(args.path || ""), workspaceRoot);
      const patchText = String(args.patchText ?? "");
      try {
        writeFileSync(p, patchText, "utf-8");
        return `Applied patch to ${args.path}`;
      } catch {
        return "(error applying patch)";
      }
    }
    case "find_symbol": {
      const query = String(args.query || "");
      const searchPath = workspaceRoot || ".";
      try {
        const out = execSync(`grep -rn "function\\|class\\|interface\\|type\\|const\\|let\\|var" "${searchPath}" --include="*.ts" --include="*.tsx" 2>/dev/null | head -20`, { encoding: "utf-8", timeout: 5000 });
        const lines = out.trim().split("\n").filter(l => !query || l.toLowerCase().includes(query.toLowerCase()));
        return lines.length > 0 ? lines.join("\n") : `(no symbols matching "${query}")`;
      } catch {
        return `(no symbols matching "${query}")`;
      }
    }
    case "read_symbol": {
      const symbolName = String(args.name ?? String(args.query ?? ""));
      const searchPath = workspaceRoot || ".";
      try {
        const out = execSync(`grep -rn -A 5 "function ${symbolName}\\|class ${symbolName}\\|interface ${symbolName}\\|const ${symbolName}" "${searchPath}" --include="*.ts" --include="*.tsx" 2>/dev/null | head -30`, { encoding: "utf-8", timeout: 5000 });
        return out.trim() || `(symbol "${symbolName}" not found)`;
      } catch {
        return `(symbol "${symbolName}" not found)`;
      }
    }
    case "todoread": {
      const todoPath = resolvePath(".opencode/tasks.json", workspaceRoot);
      try {
        return readFileSync(todoPath, "utf-8").trim();
      } catch {
        return "(no tasks)";
      }
    }
    case "todowrite": {
      const todoDir = resolvePath(".opencode", workspaceRoot);
      const todoPath = resolvePath(".opencode/tasks.json", workspaceRoot);
      const content = String(args.content ?? "");
      try {
        mkdirSync(todoDir, { recursive: true });
        writeFileSync(todoPath, JSON.stringify({ tasks: [{ content, status: "pending", priority: "medium" }] }, null, 2), "utf-8");
        return `Task written: ${content}`;
      } catch {
        return "(error writing task)";
      }
    }
    case "webfetch":
    case "websearch":
    case "skill":
      return null;
    default:
      return null;
  }
}

/**
 * Generate the expected full human-readable output from an action list.
 * Walks all actions in order — executes tools for real results so the
 * expected string matches what the user actually sees.
 */
export function generateExpectedText(actions: MockAction[], workspaceRoot?: string): string {
  const segments: string[] = [];
  const spacers: string[] = [];

  // Group consecutive tools by category
  const grouped: (MockAction | MockAction[])[] = [];
  let buffer: MockAction[] = [];
  let currentCat: string | null = null;

  for (const action of actions) {
    if (action.type !== "tool") {
      if (buffer.length > 0) {
        if (buffer.length === 1) {
          grouped.push(buffer[0]);
        } else {
          grouped.push(buffer);
        }
        buffer = [];
        currentCat = null;
      }
      grouped.push(action);
      continue;
    }

    const cat = toolCategory(action.toolName);
    if (cat !== null) {
      if (currentCat === null) {
        currentCat = cat;
        buffer.push(action);
      } else if (currentCat === cat) {
        buffer.push(action);
      } else {
        if (buffer.length === 1) {
          grouped.push(buffer[0]);
        } else {
          grouped.push(buffer);
        }
        buffer = [action];
        currentCat = cat;
      }
    } else {
      if (buffer.length > 0) {
        if (buffer.length === 1) {
          grouped.push(buffer[0]);
        } else {
          grouped.push(buffer);
        }
        buffer = [];
        currentCat = null;
      }
      grouped.push(action);
    }
  }
  if (buffer.length > 0) {
    if (buffer.length === 1) {
      grouped.push(buffer[0]);
    } else {
      grouped.push(buffer);
    }
  }

  for (const entry of grouped) {
    if (Array.isArray(entry)) {
      const cat = toolCategory((entry[0] as MockAction).toolName);
      const label = cat === "context" ? "Gathered context" : "Applied changes";
      const summary = groupSummary(entry);
      const toolsContent = entry.map((a) => toolBlock(a, workspaceRoot)).join("\n");
      segments.push(formatToolGroup(label, summary, toolsContent));
      spacers.push("\n\n");
    } else if (entry.type === "text") {
      const tokens: string[] = [];
      for (let i = 1; i <= entry.count; i++) {
        tokens.push(i === 1 ? `${entry.prefix}${i}` : ` ${entry.prefix}${i}`);
      }
      segments.push(tokens.join(""));
      spacers.push("\n\n");
    } else if (entry.type === "tool") {
      const toolResult = executeTool(entry.toolName, entry.args, workspaceRoot);
      const r = toolResult != null ? String(toolResult).trim() : "";
      segments.push(toolBlock(entry, workspaceRoot));
      spacers.push(r.length > 0 ? "\n\n" : "\n");
    } else if (entry.type === "thinking") {
      const t = entry.words.join("");
      if (t) segments.push(t);
      spacers.push("\n");
    }
  }

  let r = segments[0].trim();
  for (let i = 1; i < segments.length; i++) {
    r += spacers[i - 1] + segments[i].trim();
  }
  return r;
}

// ── Legacy helpers (used by model1000 etc. that still use mockCountStream) ─

export async function* emitTokens(
  prefix: string, from: number, to: number,
  textIndex: { v: number }, speed: number, signal?: AbortSignal,
): AsyncGenerator<any> {
  for (let i = from; i <= to; i++) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    textIndex.v++;
    const chunk = textIndex.v === 1 ? `${prefix}${i}` : ` ${prefix}${i}`;
    yield { type: "text-delta", text: chunk, delta: chunk };
    await new Promise((r) => setTimeout(r, speed));
  }
}

export async function* emitToolFn(
  toolName: string, args: unknown, result: unknown,
  speed: number,
): AsyncGenerator<any> {
  const toolCallId = `mock-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  yield { type: "tool-call", toolCallId, toolName, args };
  await new Promise((r) => setTimeout(r, speed * 5));
  if (result != null) {
    yield { type: "tool-result", toolCallId, toolName, output: result };
  }
}

export async function* emitThinkingFn(
  words: string[], speed: number, signal?: AbortSignal,
): AsyncGenerator<any> {
  for (const w of words) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    yield { type: "reasoning-delta", text: w, delta: w };
    await new Promise((r) => setTimeout(r, speed));
  }
}

export async function* mockCountStream(
  count: number,
  speed: number,
  signal?: AbortSignal,
  options?: { toolAfter?: number; thinkingAfter?: number; finalAfter?: number },
): AsyncGenerator<any> {
  const seen = new Set<string>();
  let toolCalled = false;

  for (let i = 1; i <= count; i++) {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

    if (options?.thinkingAfter && i === options.thinkingAfter) {
      const words = ["Let", " me", " think", " about", " this", "..."];
      for (const w of words) {
        if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        yield { type: "reasoning-delta", text: w, delta: w };
        await new Promise((r) => setTimeout(r, speed));
      }
    }

    if (options?.toolAfter && i === options.toolAfter && !toolCalled) {
      toolCalled = true;
      const toolCallId = `mock-tc-${Date.now()}`;
      yield { type: "tool-call", toolCallId, toolName: "bash", args: { command: "echo hello from test model" } };
      await new Promise((r) => setTimeout(r, speed * 5));
      yield { type: "tool-result", toolCallId, toolName: "bash", output: "hello from test model\n" };
    }

    if (options?.finalAfter && i === options.finalAfter) {
      const words = ["Almost", " done", "!"];
      for (const w of words) {
        if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
        yield { type: "reasoning-delta", text: w, delta: w };
        await new Promise((r) => setTimeout(r, speed));
      }
    }

    const num = String(i);
    if (!seen.has(num)) {
      seen.add(num);
      const chunk = seen.size === 1 ? num : " " + num;
      yield { type: "text-delta", text: chunk, delta: chunk };
    }
    await new Promise((r) => setTimeout(r, speed));
  }
}
