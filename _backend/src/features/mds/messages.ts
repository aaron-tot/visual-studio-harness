import type { Message } from "../../../../_shared/types";

export function messagesForModel(sessionMessages: Message[], systemBlock: string): Message[] {
  const history = sessionMessages.filter((m) => m.role !== "system");
  const content = systemBlock.trim();
  if (!content) return [...history];
  return [{ role: "system", content, timestamp: new Date().toISOString() }, ...history];
}

/**
 * True when a system message is an `additional_system_info` injection tail
 * (content starts with the wrapper tag). These are exempt from the
 * single-system-message rule: they are context tails appended after tool
 * results, one per step, and must be allowed in any number.
 */
function isAdditionalSystemInfoSystemMessage(m: { role: string; content?: unknown } | undefined): boolean {
  if (m?.role !== "system") return false;
  const raw = m.content;
  if (typeof raw !== "string") return false;
  return raw.trimStart().startsWith("<additional_system_info>");
}

export function assertExactlyOneSystemMessage(messages: Array<{ role: string; content?: unknown }>): void {
  const systemIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role === "system" && !isAdditionalSystemInfoSystemMessage(m)) systemIndexes.push(i);
  }
  if (systemIndexes.length > 1) throw new Error(`system prompt must appear exactly once before LLM call (found ${systemIndexes.length})`);
  if (systemIndexes.length === 1) {
    if (systemIndexes[0] !== 0) throw new Error(`system prompt must be the first message before LLM call (found at index ${systemIndexes[0]})`);
    const raw = messages[0]?.content;
    const content = typeof raw === "string" ? raw.trim() : "";
    if (!content) throw new Error("system prompt message is empty");
  }
}
