import { useChatStore } from "../../../chat/store";
import { EmptyState } from "../ui";
import { UsageV2Tree } from "./tree";
import { useUsageTree } from "./hooks/useUsageTree";

/**
 * Live usage tree (own + inclusive, subagent nesting, cost charts).
 * Loads GET /api/sessions/:id/usage-tree into modular collapsibles.
 */
export function UsageV2Tab() {
  const sessionId = useChatStore((s) => s.sessionId);
  const { data, loading, error, refresh } = useUsageTree(sessionId);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <div className="px-3 py-1.5 text-[9px] text-zinc-600 border-b border-zinc-800/50 space-y-0.5 flex items-start justify-between gap-2">
        <div>
          <div>Usage · live tree</div>
          <div className="text-zinc-700">
            own (incl) · cost estimate · charts · open subagent sessions
          </div>
        </div>
        {sessionId && (
          <button
            type="button"
            onClick={() => refresh()}
            className="shrink-0 text-[9px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
          >
            Refresh
          </button>
        )}
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        {loading ? (
          <EmptyState>Loading usage tree…</EmptyState>
        ) : error ? (
          <EmptyState>
            <span className="text-red-400">Error: {error}</span>
          </EmptyState>
        ) : !sessionId ? (
          <EmptyState>No session selected</EmptyState>
        ) : !data ? (
          <EmptyState>No usage data</EmptyState>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <UsageV2Tree session={data} />
          </div>
        )}
      </div>
    </div>
  );
}
