import type { Message } from "../../../_shared/types";

export type SdkChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * AI SDK 7 rejects role:system in `messages` by default.
 * Lift system rows into `instructions` and keep the rest as chat turns.
 */
export function splitSystemInstructions(messages: Message[]): {
  instructions: string | undefined;
  messages: SdkChatMessage[];
} {
  const systemParts: string[] = [];
  const chat: SdkChatMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      const text = m.content.trim();
      if (text) systemParts.push(text);
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      chat.push({ role: m.role, content: m.content });
    }
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: chat,
  };
}
