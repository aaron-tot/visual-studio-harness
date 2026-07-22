// NOTE FOR OTHER AGENTS: This component MUST have 3 collapsible levels,
// all collapsed by default:
//   1. Main card — toggles via header button click
//   2. Input   — args JSON sub-section, collapsed by default
//   3. Output  — result JSON sub-section, collapsed by default
// When status === "awaiting_permission" || "awaiting_config",
// auto-expand the main card so permission UI is visible without
// manually clicking to expand.
// Do NOT remove or flatten any of these three collapsibles.

import { useState, useEffect } from "react";
import type { PermissionDecision, ToolCallStatus } from "../../../_shared/types";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessions";
import { getToolStatusColor } from "../chat/tools/tool-status-colors";
import { ToolErrorCard } from "../chat/tools/ToolErrorCard";
import { cn } from "../../lib/utils";

function truncateMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const half = Math.floor((maxLen - 3) / 2);
  return s.slice(0, half) + "..." + s.slice(s.length - half);
}

function getArgSummary(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case "read": {
      const parts = [String(a.path ?? "")];
      if (a.offset != null) parts.push(`offset=${a.offset}`);
      if (a.limit != null) parts.push(`limit=${a.limit}`);
      return parts.filter(Boolean).join(" ");
    }
    case "glob": {
      const parts = [String(a.pattern ?? "")];
      if (a.head_limit != null) parts.push(`head=${a.head_limit}`);
      if (a.path) parts.push(`in=${a.path}`);
      return parts.filter(Boolean).join(" ");
    }
    case "grep": {
      const parts = [`/${a.pattern}/`];
      if (a.glob) parts.push(String(a.glob));
      if (a.path) parts.push(`in=${a.path}`);
      if (a.head_limit != null) parts.push(`head=${a.head_limit}`);
      return parts.filter(Boolean).join(" ");
    }
    case "write":
    case "edit":
      return String(a.path ?? "");
    case "read_symbol":
      return String(a.name ?? "");
    case "find_symbol":
      return String(a.query ?? "");
    case "bash":
      return truncateMiddle(String(a.command ?? ""), 80);
    case "apply_patch":
      return String(a.path ?? a.patchText ? `${String(a.patchText).split("\n")[0]}…` : "");
    case "task":
      return truncateMiddle(String(a.prompt ?? ""), 80);
    case "webfetch":
      return String(a.url ?? "");
    case "websearch":
      return String(a.query ?? "");
    case "todowrite": {
      const todos = a.todos;
      if (Array.isArray(todos)) return `${todos.length} todos`;
      return "";
    }
    case "todoread":
      return "";
    case "skill":
      return String(a.name ?? "");
    case "agent_change":
      return String(a.suggestedAgent ?? "");
    case "design_create":
    case "design_read":
    case "design_edit": {
      const parts = [String(a.name ?? "")];
      if (a.type) parts.push(String(a.type));
      return parts.filter(Boolean).join(" ");
    }
    case "design_abandon":
      return String(a.name ?? "");
    case "designs_list":
      return a.scope ? String(a.scope) : "";
    default:
      return "";
  }
}

interface ToolCallCardProps {
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result?: unknown;
  error?: string;
  sessionId?: string | null;
  cacheSummary?: string;
}

const Chevron = ({ open }: { open: boolean }) => (
  <span
    className={cn(
      "inline-block text-zinc-600 shrink-0 transition-transform duration-150",
      open && "rotate-90"
    )}
  >
    &#9654;
  </span>
);

export function ToolCallCard({
  toolCallId,
  toolName,
  status,
  args,
  result,
  error,
  sessionId,
  cacheSummary,
}: ToolCallCardProps) {
  const respondPermission = useChatStore((s) => s.respondPermission);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const hasWorkspace = Boolean(workspaceRoot?.trim());
  const color = getToolStatusColor(status);

  // Main card: collapsed by default, auto-expand when awaiting permission
  const [mainOpen, setMainOpen] = useState(false);
  // Sub-sections: both collapsed by default
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);

  // Auto-expand main card when awaiting user action
  useEffect(() => {
    if (status === "awaiting_permission" || status === "awaiting_config") {
      setMainOpen(true);
    }
  }, [status]);

  const resultText =
    result === undefined || result === null
      ? ""
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

  const taskId = toolName === "task" && status === "completed"
    ? resultText.match(/task_id:\s*(\S+)/)?.[1]
    : undefined;

  const argsText =
    args === undefined || args === null
      ? ""
      : typeof args === "string"
        ? args
        : JSON.stringify(args, null, 2);

  const hasInput = argsText.length > 0;
  const hasOutput = resultText.length > 0 || (status === "error" && error);

  const decide = (decision: PermissionDecision) => {
    respondPermission(toolCallId, decision, sessionId, toolName);
  };

  const chip = (
    label: string,
    decision: PermissionDecision,
    disabled?: boolean
  ) => (
    <button
      type="button"
      disabled={disabled}
      className="px-1.5 py-0.5 rounded border border-zinc-600 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
      onClick={() => decide(decision)}
    >
      {label}
    </button>
  );

  const argSummary = getArgSummary(toolName, args);

  const argsObj =
    args && typeof args === "object" ? (args as Record<string, unknown>) : null;
  const toolNameStr = typeof toolName === "string" ? toolName : "";
  const externalTool = toolNameStr?.startsWith("external_directory:")
    ? toolNameStr.slice("external_directory:".length)
    : undefined;
  const displayName = externalTool ?? toolNameStr;
  const isExternalDirectory =
    toolNameStr === "external_directory" ||
    toolNameStr?.startsWith("external_directory:") ||
    Boolean(
      argsObj &&
        ("absolutePath" in argsObj ||
          argsObj.reason === "Path is outside the session workspace")
    );

  return (
    <div
      className="rounded-lg text-xs bg-zinc-900/50"
      style={{ color: color.border.replace("#", "color-mix(in srgb, ") + " 70%, white)" } as React.CSSProperties}
    >
      {/* Header — always visible, toggles main collapse */}
      <button
        type="button"
        data-collapsible="true"
        data-collapsible-level="main"
        data-collapsible-state={mainOpen ? "open" : "closed"}
        onClick={() => setMainOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Chevron open={mainOpen} />
          <span className="font-mono font-medium shrink-0" style={{ color: color.border }}>
            {displayName}
          </span>
          {argSummary && (
            <span className="text-[10px] text-zinc-500 truncate min-w-0">
              {argSummary}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cacheSummary && (
            <span className="text-[10px] text-zinc-400 font-mono" title="Prompt cache hit on next step">
              {cacheSummary} cache
            </span>
          )}
          {taskId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                useSessionStore.getState().setActive(taskId);
              }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-600/50 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              Open session &rarr;
            </button>
          )}
          <span
            className="uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded shrink-0"
            style={{ backgroundColor: `${color.border}15`, color: color.border }}
          >
            {color.label}
          </span>
        </div>
      </button>

      {/* Expanded body */}
      {mainOpen && (
        <div className="px-3 pb-3 space-y-2">
          {/* Input section */}
          {hasInput && (
            <div className="border border-zinc-800/60 rounded-md overflow-auto">
              <button
                type="button"
                data-collapsible="true"
                data-collapsible-level="input"
                data-collapsible-state={inputOpen ? "open" : "closed"}
                onClick={() => setInputOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800/30 transition-colors cursor-pointer"
              >
                <Chevron open={inputOpen} />
                <span className="font-medium">Input</span>
                <span className={cn("text-zinc-600 ml-auto max-w-[60%] overflow-auto text-[10px]", inputOpen && "hidden")}>
                  {argsText.length > 80 ? argsText.slice(0, 80) + "…" : ""}
                </span>
              </button>
              {inputOpen && (
                <pre className="px-2 pb-2 max-h-48 overflow-auto text-zinc-500 whitespace-pre-wrap break-all text-[11px] border-t border-zinc-800/40">
                  {argsText}
                </pre>
              )}
            </div>
          )}

          {/* Permission UI — always visible when awaiting */}
          {status === "awaiting_permission" && (
            <div className="space-y-2">
              {isExternalDirectory && (
                <p className="text-[11px] text-amber-200/90">
                  {externalTool
                    ? `Tool '${externalTool}' requests access outside the session workspace.`
                    : "This path is outside the session workspace."}{" "}
                  Approve to allow just this once, or use the chips to allow/deny for this
                  tool at session / workspace / global scope.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-green-700/80 hover:bg-green-600 text-white"
                  onClick={() => decide("approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-red-800/80 hover:bg-red-700 text-white"
                  onClick={() => decide("deny")}
                >
                  Deny
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 w-full sm:w-auto">Also allow…</span>
                {chip("Session", "approve_session")}
                {chip("Workspace", "approve_workspace", !hasWorkspace)}
                {chip("Global", "approve_global")}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 w-full sm:w-auto">Also deny…</span>
                {chip("Session", "deny_session")}
                {chip("Workspace", "deny_workspace", !hasWorkspace)}
                {chip("Global", "deny_global")}
              </div>
            </div>
          )}

          {status === "awaiting_config" && (
            <p className="text-[11px] text-violet-200/90">
              Waiting for subagent model configuration (see dialog)…
            </p>
          )}

          {/* Output section */}
          {hasOutput && (
            <div className="border border-zinc-800/60 rounded-md overflow-auto">
              <button
                type="button"
                data-collapsible="true"
                data-collapsible-level="output"
                data-collapsible-state={outputOpen ? "open" : "closed"}
                onClick={() => setOutputOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800/30 transition-colors cursor-pointer"
              >
                <Chevron open={outputOpen} />
                <span className="font-medium">Output</span>
                <span className={cn("text-zinc-600 ml-auto max-w-[60%] overflow-auto text-[10px]", outputOpen && "hidden")}>
                  {resultText.length > 80 ? resultText.slice(0, 80) + "…" : ""}
                </span>
              </button>
              {outputOpen && (
                <div className="px-2 pb-2 border-t border-zinc-800/40">
                  {status === "error" && error ? (
                    <div className="pt-1">
                      <ToolErrorCard toolName={toolName} error={error} />
                    </div>
                  ) : (
                    <pre className="max-h-48 overflow-auto text-zinc-400 whitespace-pre-wrap break-all text-[11px] pt-1">
                      {resultText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
