import { useState, useCallback, useMemo } from "react";
import { ArrowLeftRight } from "lucide-react";
import { CollapsibleNode } from "../collapsible";
import { SubagentNode } from "./SubagentNode";
import { StepIoModal } from "./StepIoModal";
import {
  DetailFields,
  TokenBlock,
  Divider,
  StatusBadge,
} from "./detail/DetailFields";
import { formatOwnIncl, formatStringOwnIncl, formatDuration } from "../format/format";
import type { UsageTreeStep } from "../types";

export function StepNode({
  step,
  depth,
  sessionId,
  turnNumber,
}: {
  step: UsageTreeStep;
  depth: number;
  sessionId: string;
  turnNumber: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showIo, setShowIo] = useState(false);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const models = useMemo(() => {
    const set = new Set<string>();
    if (step.modelId) set.add(step.modelId);
    for (const sa of step.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.modelName) set.add(t.modelName);
          for (const st of t.steps ?? []) if (st.modelId) set.add(st.modelId);
        }
      }
    }
    return [...set];
  }, [step]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    if (step.providerName) set.add(step.providerName);
    for (const sa of step.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.providerName) set.add(t.providerName);
          for (const st of t.steps ?? []) if (st.providerName) set.add(st.providerName);
        }
      }
    }
    return [...set];
  }, [step]);

  const modelFmt = formatStringOwnIncl(step.modelId, models);
  const provFmt = formatStringOwnIncl(step.providerName, providers);
  const tokStr = formatOwnIncl(step.own.totalTokens, step.inclusive.totalTokens, "tok");

  const headline = [
    tokStr,
    modelFmt.text,
    provFmt.text !== "—" ? provFmt.text : null,
    step.durationMs != null ? formatDuration(step.durationMs) : null,
    step.finishReason,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasSubagents = !!(step.subagents && step.subagents.length > 0);

  const detail = (
    <div className="space-y-1">
      <DetailFields
        rows={[
          { label: "Step", value: `#${step.stepIndex}` },
          ...(step.finishReason
            ? [{ label: "Finish", value: step.finishReason }]
            : []),
          {
            label: "Model",
            value: (
              <span title={modelFmt.title} className={modelFmt.title ? "cursor-help" : undefined}>
                {modelFmt.text}
              </span>
            ),
          },
          {
            label: "Provider",
            value: (
              <span title={provFmt.title} className={provFmt.title ? "cursor-help" : undefined}>
                {provFmt.text}
              </span>
            ),
          },
          {
            label: "Status",
            value: (
              <span className="flex items-center gap-1">
                <StatusBadge status={step.status} />
                {step.status ?? "—"}
              </span>
            ),
          },
          ...(step.durationMs != null
            ? [{ label: "Duration", value: formatDuration(step.durationMs) }]
            : []),
        ]}
      />
      <Divider />
      <TokenBlock own={step.own} inclusive={step.inclusive} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowIo(true);
        }}
        className="inline-flex items-center gap-1.5 mt-1 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 px-2 py-1 rounded border border-zinc-800"
        title="View this step's input and output"
      >
        <ArrowLeftRight size={12} />
        Input/Output
      </button>
    </div>
  );

  return (
    <>
    <CollapsibleNode
      depth={depth}
      expanded={expanded}
      onToggle={toggle}
      label={`Step ${step.stepIndex}`}
      headline={headline}
      detail={detail}
    >
      {hasSubagents &&
        step.subagents!.map((sa, i) => (
          <SubagentNode
            key={`${sa.childSessionId}-${i}`}
            subagent={sa}
            depth={depth + 1}
          />
        ))}
    </CollapsibleNode>
    {showIo && (
      <StepIoModal
        sessionId={sessionId}
        turnNumber={turnNumber}
        stepIndex={step.stepIndex}
        onClose={() => setShowIo(false)}
      />
    )}
    </>
  );
}
