import { useState, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { CollapsibleNode } from "../collapsible";
import { SessionNode } from "./SessionNode";
import { DetailFields, TokenBlock, Divider } from "./detail/DetailFields";
import { formatOwnIncl } from "../format/format";
import { useSessionStore } from "../../../../sessions/store";
import type { UsageTreeSubagent } from "../types";

export function SubagentNode({
  subagent,
  depth,
}: {
  subagent: UsageTreeSubagent;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((e) => !e), []);
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
      {subagent.child && (
        <SessionNode session={subagent.child} depth={depth + 1} />
      )}
    </CollapsibleNode>
  );
}
