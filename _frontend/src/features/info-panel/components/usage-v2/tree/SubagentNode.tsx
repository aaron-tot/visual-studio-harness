import { useState, useCallback, useRef } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { CollapsibleNode } from "../collapsible";
import { SessionNode } from "./SessionNode";
import { DetailFields, TokenBlock, Divider } from "./detail/DetailFields";
import { formatOwnIncl } from "../format/format";
import { useSessionStore } from "../../../../sessions/store";
import { getUsageTree } from "../../../../../lib/api";
import type { UsageTreeSubagent, UsageTreeSession } from "../types";

export function SubagentNode({
  subagent,
  depth,
}: {
  subagent: UsageTreeSubagent;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [child, setChild] = useState<UsageTreeSession | undefined>(subagent.child);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const toggle = useCallback(() => {
    setExpanded((e) => {
      const next = !e;
      if (next && !child) {
        const reqId = ++reqRef.current;
        setLoading(true);
        getUsageTree(subagent.childSessionId)
          .then((tree) => {
            if (reqId !== reqRef.current) return;
            setChild(tree ?? undefined);
          })
          .catch(() => {
            if (reqId === reqRef.current) setChild(undefined);
          })
          .finally(() => {
            if (reqId === reqRef.current) setLoading(false);
          });
      }
      return next;
    });
  }, [child, subagent.childSessionId]);
  const setActive = useSessionStore((s) => s.setActive);

  const openChild = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setActive(subagent.childSessionId);
    },
    [setActive, subagent.childSessionId]
  );

  const tokStr = formatOwnIncl(
    subagent.own.totalTokens,
    subagent.inclusive.totalTokens,
    "tok"
  );
  const headline = [
    tokStr,
    subagent.childSessionId,
    subagent.kind,
    subagent.childTurnNumber != null ? `T${subagent.childTurnNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const detail = (
    <div className="space-y-1">
      <DetailFields
        rows={[
          { label: "Child Session", value: subagent.childSessionId },
          ...(subagent.taskLabel
            ? [{ label: "Task", value: subagent.taskLabel }]
            : []),
          { label: "Kind", value: subagent.kind },
          ...(subagent.childTurnNumber != null
            ? [{ label: "Child Turn #", value: String(subagent.childTurnNumber) }]
            : []),
        ]}
      />
      <div className="pt-1">
        <button
          type="button"
          onClick={openChild}
          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
          title="Open this subagent session in the main chat"
        >
          <ExternalLink size={10} />
          Open session
        </button>
      </div>
      <Divider />
      <TokenBlock own={subagent.own} inclusive={subagent.inclusive} />
    </div>
  );

  return (
    <CollapsibleNode
      depth={depth}
      expanded={expanded}
      onToggle={toggle}
      label={subagent.taskLabel ?? "Subagent"}
      headline={headline}
      detail={detail}
    >
      {loading ? (
        <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-zinc-500">
          <Loader2 size={12} className="animate-spin" />
          Loading session…
        </div>
      ) : child ? (
        <SessionNode session={child} depth={depth + 1} />
      ) : (
        <div className="px-3 py-2 text-[10px] text-zinc-600">No session data</div>
      )}
    </CollapsibleNode>
  );
}
