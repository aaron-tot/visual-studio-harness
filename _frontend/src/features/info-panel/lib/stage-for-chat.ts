import { useChatStore } from "../../../stores/chat";

export type StageResult =
  | "Sent to session top"
  | "Sent to session"
  | "Prepended to input"
  | "Added to input";

/**
 * Modifier-aware staging:
 * - plain click → append to input
 * - Shift → prepend to input
 * - Ctrl → send as message
 * - Ctrl+Shift → send as message (same path; reserved for future top-insert)
 */
export function stageForChat(content: string, e: { shiftKey: boolean; ctrlKey: boolean }): StageResult {
  if (e.ctrlKey) {
    useChatStore.getState().sendMessage(content, {
      agentName: null,
      providerName: "",
      modelName: "",
      thinkingEffort: "default",
    });
    return e.shiftKey ? "Sent to session top" : "Sent to session";
  }
  if (e.shiftKey) {
    document.dispatchEvent(
      new CustomEvent("VISUAL STUDIO HARNESS:stage-input", { detail: { content, position: "start" } })
    );
    return "Prepended to input";
  }
  document.dispatchEvent(
    new CustomEvent("VISUAL STUDIO HARNESS:stage-input", { detail: { content, position: "end" } })
  );
  return "Added to input";
}

export function latestDocContent(
  docs: unknown[],
  planName: string,
  mode: "spec" | "plan",
  sub: "full" | "path"
): string | null {
  if (docs.length === 0) return null;
  const version = docs.length;
  if (sub === "path") {
    return `plans/${planName}/${mode}V${version}.json`;
  }
  return JSON.stringify(docs[docs.length - 1], null, 2);
}
