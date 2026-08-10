/**
 * MessageRow
 *
 * Renders a single message in the thread. User messages get a simple
 * right-aligned bubble. Assistant messages are wrapped in one
 * AgentMessageCard per turn, with each part (thinking, text, tool, etc.)
 * rendered as a distinct section inside it — matching the OpenCode pattern
 * where the card header appears once per turn.
 *
 * Errors always render UNDER the agent bubble in a red shaded ErrorPart
 * (data-testid="chat-error") — never only inside the card body.
 */

import { memo, useEffect, useState } from "react";
import { Brain } from "lucide-react";
import type { Message } from "../../../_shared/types";
import type { MessagePartType } from "../../../_shared/types";
import { AgentMessageCard } from "./agents/AgentMessageCard";
import { MessagePart } from "./MessagePart";
import { TextPart } from "./parts/TextPart";
import { ThinkingPart } from "./parts/ThinkingPart";
import { ErrorPart } from "./parts/ErrorPart";
import { ContextToolGroup, groupContextParts } from "./tools/ContextToolGroup";
import { StepToolGroup } from "./tools/StepToolGroup";
import { groupByStep, type GroupedParts } from "./tools/group-by-step";
import { isAdditionalSystemInfoPart, extractSystemInfoContent } from "./system-info";
import { TurnContextMenu } from "./TurnContextMenu";
import { useChatStore } from "../../stores/chat";
import { StreamingTimer } from "./StreamingTimer";
import { RetryCountdown } from "./RetryCountdown";
import { summarizeRange } from "../../lib/api";
import { TurnInspectorModal } from "./TurnInspectorModal";
import { CopyButton } from "./CopyButton";
import { extractPrimaryText, extractAllText } from "../../lib/extract-message-text";
import { getTurn } from "../../lib/api";
import { computeToolGroups } from "../../lib/turn-inspector/cache-hit";

interface MessageRowProps {
  message: Message;
  isStreaming?: boolean;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Attaches each standalone `additional_system_info` injection to the tool(s)
 * of the step it was prepared for (same stepIndex):
 * - batch (array of tools) → append the injection as the last grey item;
 * - single tool → set `asiContent` so the tool card nests it in its Output;
 * - no matching tool (zero-tool step) → keep it standalone.
 */
function attachAsiToTools(parts: GroupedParts[]): GroupedParts[] {
  const out: GroupedParts[] = [];
  for (const part of parts) {
    if (!Array.isArray(part) && isAdditionalSystemInfoPart(part)) {
      const asiIdx = (part as any).stepIndex as number | undefined;
      let attached = false;
      for (let i = out.length - 1; i >= 0; i--) {
        const prev = out[i];
        const entryTools = Array.isArray(prev) ? prev : [prev];
        const stepTool = entryTools.find(
          (p) => p.type === "tool" && !isAdditionalSystemInfoPart(p) && p.stepIndex === asiIdx,
        );
        if (stepTool) {
          if (Array.isArray(prev)) {
            out[i] = [...prev, part];
          } else {
            (prev as any).asiContent = extractSystemInfoContent(part);
          }
          attached = true;
          break;
        }
      }
      if (!attached) out.push(part);
    } else {
      out.push(part);
    }
  }
  return out;
}

function collectErrors(message: Message): Array<{ message: string; raw?: string; isCustom?: boolean }> {  const out: Array<{ message: string; raw?: string; isCustom?: boolean }> = [];
  const seen = new Set<string>();
  const push = (messageText: string, raw?: string, isCustom?: boolean) => {
    const key = messageText.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ message: messageText, raw, isCustom });
  };

  if (message.errorDetail?.message) {
    push(message.errorDetail.message, message.errorDetail.raw, message.errorDetail.isCustom);
  }
  for (const p of message.parts ?? []) {
    if (p.type === "error") {
      push(p.message, p.raw, p.isCustom);
    }
  }
  if (message.content?.startsWith("[Error:")) {
    push(message.content.replace(/^\[Error:\s*/, "").replace(/\]$/, ""));
  }
  return out;
}

function renderPart(
  part: MessagePartType,
  i: number,
  message: Message,
  toolCacheByCallId: Record<string, string>,
  isStreaming?: boolean,
  thinkingCollapsed?: boolean
) {
  // Parallel step batch (from groupByStep) -> StepToolGroup; category run -> ContextToolGroup
  if (Array.isArray(part)) {
    const hasStep = part.some((p) => p.type === "tool" && p.stepIndex != null);
    return hasStep ? (
      <StepToolGroup key={`batch-${i}`} parts={part} toolCacheByCallId={toolCacheByCallId} />
    ) : (
      <ContextToolGroup key={`group-${i}`} parts={part} toolCacheByCallId={toolCacheByCallId} />
    );
  }

  // Errors render under the bubble, not inline in the card body
  if (part.type === "error") {
    return null;
  }

  // Thinking gets its own section
  if (part.type === "reasoning") {
    return <ThinkingPart key={i} content={part.content} collapsed={thinkingCollapsed} isStreaming={isStreaming} liveTps={part.liveTps} />;
  }

  // Text part
  if (part.type === "text") {
    return (
      <TextPart
        key={i}
        content={part.content}
        isStreaming={isStreaming}
        agentName={message.agentName || "Default (no system prompt)"}
        modelName={message.modelName}
        durationMs={message.durationMs}
      />
    );
  }

  // Everything else (tools, questions, agent, etc.)
  return (
    <MessagePart
      key={i}
      part={part}
      allParts={message.parts ?? []}
      toolCacheByCallId={toolCacheByCallId}
      isStreaming={isStreaming}
      agentName={message.agentName || "Default (no system prompt)"}
      modelName={message.modelName}
      durationMs={message.durationMs}
    />
  );
}

function MessageRowInner({ message, isStreaming }: MessageRowProps) {
  const isUser = message.role === "user";
  const agentName = message.agentName || "Default (no system prompt)";
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const displayModelName = message.modelName || sessionMeta?.modelName;
  const displayProviderName = message.providerName || sessionMeta?.providerName;
  const streamingStartTime = useChatStore((s) => s.streamingStartTime);

  // Find the turn ID for this user message from the turns store
  const sessionId = useChatStore((s) => s.sessionId);
  const allMessages = useChatStore((s) => s.messages);
  const inspectedTurnId = useChatStore((s) => s.inspectedTurnId);
  const setInspectedTurnId = useChatStore((s) => s.setInspectedTurnId);

  // Preferred lookup number: real DB turn_number when present (summaries carry both
  // turnId = end-turn anchor and turnNumber = DB number). Normal turns only set
  // turnId == turn_number, so fall back to it. Using turnNumber here means { } and
  // tool-cache lookups hit the summary's OWN DB row instead of the anchor turn.
  const turnId = message.turnNumber ?? message.turnId ?? null;

  // Always declare hooks before any early return
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  const [toolCacheByCallId, setToolCacheByCallId] = useState<Record<string, string>>({});
  const turnStatus = message.status || (message.success === false ? "error" : message.success === true ? "success" : "");
  const isFailedStatus = turnStatus && turnStatus !== "success" && turnStatus !== "streaming" && turnStatus !== "pending";

  // Track which tools have completed so we re-fetch cache data when new tools finish
  const completedToolKey = (message.parts ?? [])
    .filter((p) => p.type === "tool" && (p as any).status === "completed")
    .map((p) => (p as any).toolCallId)
    .join(",");

  useEffect(() => {
    let cancelled = false;
    // Candidate rows only: user / no-session / no-tool rows never show a badge.
    const hasTool = (message.parts ?? []).some((p) => p.type === "tool");
    if (isUser || !sessionId || !hasTool) {
      setToolCacheByCallId({});
      return;
    }

    const loadCache = async () => {
      // turnId may be null early in streaming (only set on first tool_end).
      if (turnId == null) return;
      try {
        const res = await getTurn(sessionId, turnId);
        const turn = res?.turn;
        if (!turn || cancelled) return;
        const groups = computeToolGroups(turn);
        const next: Record<string, string> = {};
        for (const g of groups) {
          const cacheText = g.cacheHit?.formatted ?? "0 / 0 (0.0%)";
          for (const t of g.tools) {
            if (t.toolCallId) next[t.toolCallId] = cacheText;
          }
        }
        if (!cancelled) setToolCacheByCallId(next);
      } catch {
        if (!cancelled) setToolCacheByCallId({});
      }
    };

    void loadCache();

    // The cache for a tool group comes from the NEXT step's usage, which is only
    // persisted at that step's finish. A committed turn's `message.parts` never
    // changes identity again, so this effect runs once on mount; if that single
    // fetch raced finalization (or turnId was still null), the map stays empty
    // with no retry. Poll until the turn is settled so the badge eventually
    // appears without needing a manual re-mount.
    let settled = false;
    const stop = () => {
      settled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    pollTimer = setInterval(() => {
      if (cancelled || settled) return;
      void loadCache().then(() => {
        // A non-streaming turn is terminal: one fetch (or prior poll) reflects
        // the final DB state, so stop polling after it completes.
        if (!isStreaming) stop();
      });
    }, 1500);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [isUser, message.parts, sessionId, turnId, completedToolKey, isStreaming]);

  // User messages: simple right-aligned bubble
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number } | null>(null);

  if (isUser) {
    return (
      <>
        <div className="flex flex-col items-end" data-user-msg
          onContextMenu={(e) => {
            if (turnId == null) return;
            e.preventDefault();
            setCtxMenuPos({ x: e.clientX, y: e.clientY });
          }}
        >
          <div className="rounded-lg px-4 py-2 text-sm max-w-[80%] bg-blue-600/20 border border-blue-600/30 text-zinc-100 relative group">
            <p className="whitespace-pre-wrap">{message.content}</p>
            {turnId !== null && (
              <button
                type="button"
                className="absolute -top-2 -left-2 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-zinc-300 text-xs bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5"
                title={`Inspect turn #${turnId}`}
                onClick={() => setInspectedTurnId(turnId)}
              >
                {"{ }"}
              </button>
            )}
          </div>
          <span className="text-xs text-zinc-600 mt-0.5 px-1 flex items-center gap-1">
            <CopyButton
              getPrimaryText={() => extractPrimaryText(message)}
              getAllText={() => extractAllText(message)}
            />
            {formatTime(message.timestamp)}
          </span>
</div>
      {/* Streaming timer - under the bubble */}
      {!isUser && isStreaming && streamingStartTime && (
        <div className="w-full flex justify-end px-1 mt-0.5">
          <StreamingTimer startTime={streamingStartTime} isStreaming={isStreaming} />
        </div>
      )}
      {ctxMenuPos && turnId != null && sessionId && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setCtxMenuPos(null)} />
            <TurnContextMenu
              sessionId={sessionId}
              turnId={turnId}
              messages={allMessages}
              x={ctxMenuPos.x}
              y={ctxMenuPos.y}
              onClose={() => setCtxMenuPos(null)}
            />
          </>
        )}
        {inspectedTurnId !== null && sessionId && (
          <TurnInspectorModal
            sessionId={sessionId}
            turnNumber={inspectedTurnId}
            onClose={() => setInspectedTurnId(null)}
          />
        )}
      </>
    );
  }

  // Single card per assistant turn
  const bodyParts = message.parts?.filter((p) => p.type !== "error") ?? [];
  const groupedParts = bodyParts.length ? attachAsiToTools(groupByStep(bodyParts)) : undefined;
  const hasReasoning = message.parts?.some((p) => p.type === "reasoning") ?? false;
  const errors = collectErrors(message);
  const isError = isFailedStatus || errors.length > 0;

  return (
    <>
    <div data-assistant-msg className="flex items-end w-full group"
      onContextMenu={(e) => {
        if (turnId == null) return;
        e.preventDefault();
        setCtxMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className={`flex-1 min-w-0 ${isError ? "rounded-lg ring-1 ring-red-500/40 bg-red-950/20 p-1" : ""}`}>
        <AgentMessageCard
          agentName={agentName}
          status={isStreaming ? "streaming" : isError ? "error" : "completed"}
        >
          {groupedParts ? (
            <div className="space-y-2">
              {groupedParts.map((part, i) => renderPart(part, i, message, toolCacheByCallId, isStreaming, thinkingCollapsed))}
            </div>
          ) : (
            <TextPart
              content={message.content?.startsWith("[Error:") ? "" : message.content}
              isStreaming={isStreaming}
              className={isError ? "text-red-300" : undefined}
            />
          )}
        </AgentMessageCard>

        {/* Live output TPS — right-aligned under the bubble while streaming */}
        {isStreaming && <OutputTpsBadge />}

        {/* Live retry countdown - shows during backend retry wait */}
        {useChatStore.getState().retryCountdown && (
          <RetryCountdown {...useChatStore.getState().retryCountdown} />
        )}

        {/* Errors ALWAYS under the bubble (red shaded), with stable test id */}
        {errors.map((err, i) => (
          <ErrorPart
            key={`err-${i}-${err.message.slice(0, 24)}`}
            message={err.message}
            raw={err.raw}
            isCustom={err.isCustom}
          />
        ))}

        <span data-testid="agent-footer-meta" className="text-xs text-zinc-600 mt-0.5 px-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isStreaming && (
          <CopyButton
            getPrimaryText={() => extractPrimaryText(message)}
            getAllText={() => extractAllText(message)}
          />
        )}
        {formatTime(message.timestamp)}
        {agentName !== "Default (no system prompt)" && <span>{agentName}</span>}
        {displayProviderName && <span>{displayProviderName}</span>}
        {displayModelName && <span>{displayModelName}</span>}
        {!isStreaming && message.durationMs !== undefined && message.durationMs >= 0 && (
          <span>
            {message.durationMs < 1000
              ? "<1s"
              : `${(message.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </span>
      {isError && turnStatus && (
        <div className="text-right px-1 mt-0.5">
          <span className="text-[10px] text-red-400/80">{turnStatus}</span>
        </div>
      )}
      </div>
      {hasReasoning && (
        <button
          type="button"
          onClick={() => setThinkingCollapsed((v) => !v)}
          className={`sticky bottom-0 self-end ml-2 mb-1 p-1.5 rounded-md transition-all flex-shrink-0 z-10 ${
            thinkingCollapsed
              ? "text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800"
              : "text-purple-400 bg-purple-500/10 hover:bg-purple-500/20"
          }`}
          title={thinkingCollapsed ? "Expand thinking" : "Collapse thinking"}
        >
          <Brain size={16} />
        </button>
      )}
    </div>
    {ctxMenuPos && turnId != null && sessionId && (
      <>
        <div className="fixed inset-0 z-50" onClick={() => setCtxMenuPos(null)} />
        <TurnContextMenu
          sessionId={sessionId}
          turnId={turnId}
          messages={allMessages}
          x={ctxMenuPos.x}
          y={ctxMenuPos.y}
          onClose={() => setCtxMenuPos(null)}
        />
      </>
    )}
    </>
  );
}

/** Live output tokens/sec under the agent bubble — subscribes in isolation so
 * historical (non-streaming) rows never re-render on token updates. */
function OutputTpsBadge() {
  const tps = useChatStore((s) => s.streamingOutputTps);
  if (tps == null) return null;
  return (
    <div className="w-full flex justify-end px-1 mt-0.5">
      <span
        title="Live TPS · calculated by VSH (chars/4 estimate)"
        className="uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded font-mono text-zinc-500"
        style={{ backgroundColor: "#18181b" }}
      >
        {Math.round(tps)} t/s
      </span>
    </div>
  );
}

export const MessageRow = memo(MessageRowInner, (prev, next) => {
  // Bail out (skip re-render) if all props are the same by value.
  // During streaming only the last message changes reference; memo-izing
  // stable historical messages avoids cascading re-renders on every token.
  if (prev.isStreaming !== next.isStreaming) return false;
  return prev.message === next.message;
});
