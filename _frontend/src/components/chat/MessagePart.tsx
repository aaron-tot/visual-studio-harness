/**
 * MessagePart
 *
 * Polymorphic dispatcher: routes each MessagePartType to the correct
 * specialized renderer. Sub-agent tool calls (those with parentToolCallId)
 * are filtered out at the top level and rendered nested inside their
 * parent task tool card.
 */

import type { MessagePartType } from "../../../_shared/types";
import { useChatStore } from "../../stores/chat";
import { TextPart } from "./parts/TextPart";
import { ThinkingPart } from "./parts/ThinkingPart";
import { ToolCallPart } from "./parts/ToolCallPart";
import { QuestionPart } from "./parts/QuestionPart";
import { AgentPart } from "./parts/AgentPart";
import { SubtaskPart } from "./parts/SubtaskPart";

interface MessagePartProps {
  part: MessagePartType;
  /** All parts in this message, used for nesting sub-agent tools */
  allParts?: MessagePartType[];
  isStreaming?: boolean;
  /** Agent name for text part meta line */
  agentName?: string;
  /** Model name for text part meta line */
  modelName?: string;
  /** Response duration for text part meta line */
  durationMs?: number;
}

export function MessagePart({ part, allParts, isStreaming, agentName, modelName, durationMs }: MessagePartProps) {
  const sessionId = useChatStore((s) => s.sessionId);

  // Skip sub-agent child tool calls at the top level — they render nested inside the task card
  if (part.type === "tool" && part.parentToolCallId) {
    return null;
  }

  switch (part.type) {
    case "text":
      return <TextPart content={part.content} isStreaming={isStreaming} />;

    case "reasoning":
      return <ThinkingPart content={part.content} isStreaming={isStreaming} />;

    case "tool": {
      // For task tool calls, find and pass child tool calls
      const childParts = part.toolName === "task" && allParts
        ? allParts.filter(
            (p) => p.type === "tool" && p.parentToolCallId === part.toolCallId
          )
        : undefined;

      return (
        <ToolCallPart
          toolCallId={part.toolCallId}
          toolName={part.toolName}
          status={part.status}
          args={part.args}
          result={part.result}
          error={part.error}
          sessionId={sessionId}
          childParts={childParts}
        />
      );
    }

    case "question":
      return <QuestionPart questions={part.questions} />;

    case "agent":
      return <AgentPart name={part.name} />;

    case "subtask":
      return <SubtaskPart label={part.label} />;

    case "snapshot":
      return (
        <div className="border border-zinc-700/50 rounded-lg px-3 py-1.5 my-1 text-[10px] text-zinc-500 font-mono">
          snapshot {part.hash.slice(0, 8)}
        </div>
      );

    case "step-finish":
      return (
        <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-zinc-600 border-t border-zinc-800/50 mt-1">
          {part.cost !== undefined && <span>${part.cost.toFixed(4)}</span>}
          {part.tokens !== undefined && <span>{part.tokens} tokens</span>}
        </div>
      );

    case "file":
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/60 text-[10px] text-zinc-400">
          <span className="text-blue-400/70">@</span>
          {part.filename}
        </span>
      );

    case "retry":
      return (
        <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg px-3 py-1.5 my-1 text-[10px] text-amber-400/80">
          Retry attempt {part.attempt}
          {part.error ? `: ${part.error}` : ""}
        </div>
      );

    case "patch":
      return (
        <div className="border border-zinc-700/30 rounded-lg px-3 py-1.5 my-1 text-[10px] text-zinc-500">
          [patch: {part.files.length} files]
        </div>
      );

    case "error":
      // Errors are collected and rendered under the bubble by MessageRow
      // (data-testid="chat-error"). Skip inline render here.
      return null;

    default:
      return null;
  }
}
