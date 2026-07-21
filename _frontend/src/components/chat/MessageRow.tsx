/**
 * MessageRow
 *
 * Renders a single message in the thread. User messages get a simple
 * right-aligned bubble. Assistant messages are wrapped in one
 * AgentMessageCard per turn, with each part (thinking, text, tool, etc.)
 * rendered as a distinct section inside it — matching the OpenCode pattern
 * where the card header appears once per turn.
 */

import { useState } from "react";
import { Brain } from "lucide-react";
import type { Message } from "../../../_shared/types";
import type { MessagePartType } from "../../../_shared/types";
import { AgentMessageCard } from "./agents/AgentMessageCard";
import { MessagePart } from "./MessagePart";
import { TextPart } from "./parts/TextPart";
import { ThinkingPart } from "./parts/ThinkingPart";
import { ErrorPart } from "./parts/ErrorPart";
import { ContextToolGroup, groupContextParts } from "./tools/ContextToolGroup";
import { useChatStore } from "../../stores/chat";
import { TurnInspectorModal } from "./TurnInspectorModal";
import { CopyButton } from "./CopyButton";
import { extractPrimaryText, extractAllText } from "../../lib/extract-message-text";

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

function renderPart(part: MessagePartType, i: number, message: Message, isStreaming?: boolean, thinkingCollapsed?: boolean) {
  // Context tool group
  if (Array.isArray(part)) {
    return <ContextToolGroup key={`group-${i}`} parts={part} />;
  }

  // Thinking gets its own section
  if (part.type === "reasoning") {
    return <ThinkingPart key={i} content={part.content} collapsed={thinkingCollapsed} isStreaming={isStreaming} />;
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

  if (part.type === "error") {
    console.log("MESSAGE_ROW_RENDER_ERROR", { message: part.message, raw: part.raw, isCustom: part.isCustom, agentName: message.agentName });
    return (
      <ErrorPart
        key={i}
        message={part.message}
        raw={part.raw}
        isCustom={part.isCustom}
      />
    );
  }

  // Everything else (tools, questions, agent, etc.)
  return (
    <MessagePart
      key={i}
      part={part}
      allParts={message.parts ?? []}
      isStreaming={isStreaming}
      agentName={message.agentName || "Default (no system prompt)"}
      modelName={message.modelName}
      durationMs={message.durationMs}
    />
  );
}

export function MessageRow({ message, isStreaming }: MessageRowProps) {
  const isUser = message.role === "user";
  const agentName = message.agentName || "Default (no system prompt)";
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const displayModelName = message.modelName || sessionMeta?.modelName;
  const displayProviderName = message.providerName || sessionMeta?.providerName;

  // Find the turn ID for this user message from the turns store
  const sessionId = useChatStore((s) => s.sessionId);
  const inspectedTurnId = useChatStore((s) => s.inspectedTurnId);
  const setInspectedTurnId = useChatStore((s) => s.setInspectedTurnId);

  const turnId = isUser ? (message.turnId ?? null) : null;

  // Always declare hooks before any early return
  const [thinkingCollapsed, setThinkingCollapsed] = useState(true);
  const turnStatus = message.status || (message.success === false ? "error" : message.success === true ? "success" : "");
  const isFailedStatus = turnStatus && turnStatus !== "success" && turnStatus !== "streaming" && turnStatus !== "pending";

  // User messages: simple right-aligned bubble
  if (isUser) {
    return (
      <>
        <div className="flex flex-col items-end" data-user-msg>
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
  const groupedParts = message.parts?.length ? groupContextParts(message.parts) : undefined;
  const hasReasoning = message.parts?.some((p) => p.type === "reasoning") ?? false;
  const isError = isFailedStatus;

  return (
    <div data-assistant-msg className="flex items-end w-full group">
      <div className={`flex-1 min-w-0 ${isError ? "rounded-lg ring-1 ring-red-500/40 bg-red-950/20" : ""}`}>
        <AgentMessageCard
          agentName={agentName}
          status={isStreaming ? "streaming" : isError ? "error" : "completed"}
        >
          {groupedParts ? (
            <div className="space-y-2">
              {groupedParts.map((part, i) => renderPart(part, i, message, isStreaming, thinkingCollapsed))}
            </div>
          ) : isError && message.errorDetail ? (
            <ErrorPart
              message={message.errorDetail.message}
              raw={message.errorDetail.raw}
              isCustom={message.errorDetail.isCustom}
            />
          ) : isError && message.content?.startsWith("[Error:") ? (
            <ErrorPart message={message.content.replace(/^\[Error:\s*/, "").replace(/\]$/, "")} />
          ) : (
            <TextPart
              content={message.content}
              isStreaming={isStreaming}
              className={isError ? "text-red-300" : undefined}
            />
          )}
        </AgentMessageCard>
        <span className="text-xs text-zinc-600 mt-0.5 px-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isStreaming && (
          <CopyButton
            getPrimaryText={() => extractPrimaryText(message)}
            getAllText={() => extractAllText(message)}
          />
        )}
        {formatTime(message.timestamp)}
        {!isStreaming && (
          <>
            {agentName !== "Default (no system prompt)" && <span>{agentName}</span>}
            {displayProviderName && <span>{displayProviderName}</span>}
            {displayModelName && <span>{displayModelName}</span>}
            {message.durationMs !== undefined && message.durationMs >= 0 && (
              <span>
                {message.durationMs < 1000
                  ? "<1s"
                  : `${(message.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-zinc-400 ml-0.5 animate-pulse" />
        )}
      </span>
      {isError && (
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
  );
}
