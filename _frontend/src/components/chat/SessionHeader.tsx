import { useState, useEffect } from "react";
import { useChatStore } from "../../stores/chat";
import { SessionConfigModal } from "./SessionConfigModal";

export function SessionHeader() {
  const sessionId = useChatStore((s) => s.sessionId);
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);

  return (
    <div className="border-b border-zinc-800 px-4 py-1.5 flex items-center">
      {workspaceRoot && (
        <span className="text-[10px] text-zinc-600 font-mono truncate block" title={workspaceRoot}>
          {workspaceRoot}
        </span>
      )}
    </div>
  );
}
