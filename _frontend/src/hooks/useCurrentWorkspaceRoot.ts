import { useSessionViewStore } from "../stores/sessionView";
import { useSessionStore } from "../features/sessions/store";
import { useChatStore } from "../stores/chat";

export function useCurrentWorkspaceRoot(): string | undefined {
  const sessionId = useSessionViewStore((s) => s.currentSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const chatWorkspaceRoot = useChatStore((s) => s.workspaceRoot);

  if (sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (session?.workspaceRoot) return session.workspaceRoot;
  }

  return chatWorkspaceRoot || undefined;
}
