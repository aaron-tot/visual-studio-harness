import type { Message, MessagePartType } from "../../_shared/types";

function partText(p: MessagePartType): string | null {
  switch (p.type) {
    case "text":
      return p.content;
    case "reasoning":
      return p.content;
    case "tool":
      return [p.args ? JSON.stringify(p.args, null, 2) : "", p.result ? JSON.stringify(p.result, null, 2) : "", p.error || ""].filter(Boolean).join("\n");
    case "question":
      return p.questions.join("\n");
    case "agent":
      return p.name;
    case "subtask":
      return p.label;
    case "snapshot":
      return p.hash;
    case "step-finish":
      return [p.cost !== undefined ? `$${p.cost.toFixed(4)}` : "", p.tokens !== undefined ? `${p.tokens} tokens` : ""].filter(Boolean).join(" ");
    case "file":
      return p.filename;
    case "retry":
      return `Retry attempt ${p.attempt}${p.error ? `: ${p.error}` : ""}`;
    case "patch":
      return `[patch: ${p.files.length} files]`;
    default:
      return null;
  }
}

function formatPartForCopy(p: MessagePartType): string | null {
  switch (p.type) {
    case "text":
      return JSON.stringify({ type: "text", content: p.content }, null, 2);
    case "reasoning":
      return JSON.stringify({ type: "thinking", content: p.content }, null, 2);
    case "tool": {
      const obj: Record<string, unknown> = { type: `tool:${p.toolName}` };
      if (p.args !== undefined && p.args !== null) obj.input = p.args;
      if (p.result !== undefined && p.result !== null) obj.output = p.result;
      if (p.error) obj.output = { error: p.error };
      return JSON.stringify(obj, null, 2);
    }
    case "question":
      return JSON.stringify({ type: "question", questions: p.questions }, null, 2);
    case "agent":
      return JSON.stringify({ type: "agent", name: p.name }, null, 2);
    case "subtask":
      return JSON.stringify({ type: "subtask", label: p.label }, null, 2);
    case "snapshot":
      return JSON.stringify({ type: "snapshot", hash: p.hash }, null, 2);
    case "step-finish": {
      const obj: Record<string, unknown> = { type: "step-finish" };
      if (p.cost !== undefined) obj.cost = p.cost;
      if (p.tokens !== undefined) obj.tokens = p.tokens;
      return JSON.stringify(obj, null, 2);
    }
    case "file":
      return JSON.stringify({ type: "file", filename: p.filename }, null, 2);
    case "retry": {
      const obj: Record<string, unknown> = { type: "retry", attempt: p.attempt };
      if (p.error) obj.error = p.error;
      return JSON.stringify(obj, null, 2);
    }
    case "patch":
      return JSON.stringify({ type: "patch", files: p.files }, null, 2);
    default:
      return null;
  }
}

export function extractPrimaryText(message: Message): string {
  if (message.role === "user") {
    return message.content;
  }
  if (message.parts) {
    return message.parts
      .filter((p): p is Extract<MessagePartType, { type: "text" }> & { content: string } =>
        p.type === "text"
      )
      .map((p) => p.content)
      .join("\n");
  }
  return message.content;
}

export function extractAllText(message: Message): string {
  const parts: string[] = [];

  if (message.role === "user") {
    parts.push(message.content);
    return parts.join("\n");
  }

  if (message.parts) {
    for (const p of message.parts) {
      const t = formatPartForCopy(p);
      if (t) parts.push(t);
    }
  }

  if (parts.length === 0) {
    parts.push(message.content);
  }

  return parts.join("\n\n");
}
