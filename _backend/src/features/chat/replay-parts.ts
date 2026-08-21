import type { ModelMessage as CoreMessage, TextPart, ToolCallPart } from "ai";
import { normalizeToolInput } from "./tool-input";

/** Reasoning parts emitted by this builder. `ai` does not re-export ReasoningPart; this shape is structurally compatible. */
type EmittedReasoningPart = { type: "reasoning"; text: string };

type ContentPart = TextPart | ToolCallPart | EmittedReasoningPart;

export interface ReplayPartRow {
  type: string;
  data: string;
  status: string | null;
  toolCallId: string | null;
  toolName: string | null;
}

export interface ReplayPartOptions {
  includeTextParts: boolean;
  includeTools: boolean;
  includeReasoningParts: boolean;
  includePatchParts: boolean;
  includeOtherParts: boolean;
}

export function parsePartData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data);
  } catch {
    return { content: data };
  }
}

/**
 * Reads a persisted `additional_system_info` injection (a `tool` stepPart with
 * `toolName: "additional_system_info"` and `data.kind === "system-info"` /
 * `data.additionalSystemInfo === true`). Returns the verbatim content and the
 * deterministic toolCallId so the fabricated call + result stay balanced.
 * `toolCallId` may come from the part column (persistence path) or `data`
 * (audit-friendly form). Returns null for normal tool parts.
 */
export function readAdditionalSystemInfoData(
  data: Record<string, unknown>,
  toolCallId?: string | null,
): { content: string; toolCallId: string } | null {
  if (!(data.additionalSystemInfo === true) && data.kind !== "system-info") return null;
  const content = typeof data.content === "string" ? data.content : "";
  const callId = typeof data.toolCallId === "string" ? data.toolCallId : toolCallId ?? "";
  if (!content || !callId) return null;
  return { content, toolCallId: callId };
}

function ensureReasoningBeforeTools(content: ContentPart[]): ContentPart[] {
  const hasTool = content.some((p) => p.type === "tool-call");
  if (!hasTool) return content;
  const hasReasoning = content.some((p) => p.type === "reasoning");
  if (hasReasoning) return content;
  // Thinking-mode gateways require reasoning_content on assistant tool-call
  // messages. Empty text is enough for fabrications / tool-only steps; the
  // wire shim also forces the key if the SDK omits empty reasoning.
  return [{ type: "reasoning", text: "" }, ...content];
}

function pushAssistant(
  out: CoreMessage[],
  content: ContentPart[],
): void {
  const next = ensureReasoningBeforeTools(content);
  if (next.length === 0) return;
  out.push({ role: "assistant", content: next });
}

/**
 * Replay ordered step_parts into SDK messages without collapsing multi-step
 * rounds. Real model tool rounds stay as assistant → tool result(s). ASI is
 * always its own assistant tool_call + tool result pair (spec: after the
 * causing step's tools; never merged into a mega tool_calls list).
 *
 * Parts must already be in turn order (typically global `seq`).
 */
export function replayPartsToMessages(
  parts: ReplayPartRow[],
  opts: ReplayPartOptions,
): CoreMessage[] {
  const out: CoreMessage[] = [];
  let pendingContent: ContentPart[] = [];
  let pendingToolResults: CoreMessage[] = [];

  const flushModel = () => {
    if (pendingContent.length === 0 && pendingToolResults.length === 0) return;
    pushAssistant(out, pendingContent);
    out.push(...pendingToolResults);
    pendingContent = [];
    pendingToolResults = [];
  };

  for (const part of parts) {
    const data = parsePartData(part.data);

    switch (part.type) {
      case "text": {
        if (opts.includeTextParts) {
          const text = typeof data.content === "string" ? data.content : "";
          if (text) pendingContent.push({ type: "text", text });
        }
        break;
      }
      case "tool": {
        const asi = readAdditionalSystemInfoData(data, part.toolCallId);
        if (asi) {
          if (!opts.includeTools) break;
          // Spec: ASI is a `system`-role tail after the step's real tools — same
          // position as the old fabricated pair, but not callable by the model.
          flushModel();
          out.push({ role: "system", content: asi.content });
          break;
        }
        if (opts.includeTools && part.toolCallId) {
          const args = normalizeToolInput(data.args);
          pendingContent.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName ?? "",
            input: args,
          });
          const rawOutput = data.result ?? data.output ?? "";
          pendingToolResults.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName ?? "",
                output:
                  part.status === "completed"
                    ? { type: "text", value: typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput) }
                    : { type: "error-text", value: `Tool call ${part.status} before returning a result` },
              },
            ],
          });
        }
        break;
      }
      case "reasoning": {
        if (opts.includeReasoningParts) {
          pendingContent.push({
            type: "reasoning",
            text: typeof data.content === "string" ? data.content : "",
          });
        }
        break;
      }
      case "patch": {
        if (opts.includePatchParts) {
          pendingContent.push({
            type: "text",
            text: typeof data.patch === "string" ? data.patch : JSON.stringify(data.patch),
          });
        }
        break;
      }
      case "error":
      case "retry":
        break;
      default: {
        if (opts.includeOtherParts) {
          const text = typeof data.content === "string" ? data.content : JSON.stringify(data);
          if (text) pendingContent.push({ type: "text", text });
        }
        break;
      }
    }
  }

  flushModel();
  return out;
}
