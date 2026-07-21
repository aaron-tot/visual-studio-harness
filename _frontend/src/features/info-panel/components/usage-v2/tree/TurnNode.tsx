import { useState, useCallback, useMemo } from "react";
import { CollapsibleNode } from "../collapsible";
import { StepNode } from "./StepNode";
import {
  DetailFields,
  TokenBlock,
  Divider,
  StatusBadge,
  Duration,
  CountOwnIncl,
} from "./detail/DetailFields";
import { formatOwnIncl, formatStringOwnIncl, formatDuration, formatTokens } from "../format/format";
import type { UsageTreeTurn } from "../types";

function collectTurnModels(turn: UsageTreeTurn): string[] {
  const set = new Set<string>();
  if (turn.modelName) set.add(turn.modelName);
  for (const s of turn.steps) {
    if (s.modelId) set.add(s.modelId);
    for (const sa of s.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.modelName) set.add(t.modelName);
          for (const st of t.steps) if (st.modelId) set.add(st.modelId);
        }
      }
    }
  }
  return [...set];
}

function collectTurnProviders(turn: UsageTreeTurn): string[] {
  const set = new Set<string>();
  if (turn.providerName) set.add(turn.providerName);
  for (const s of turn.steps) {
    if (s.providerName) set.add(s.providerName);
    for (const sa of s.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.providerName) set.add(t.providerName);
          for (const st of t.steps) if (st.providerName) set.add(st.providerName);
        }
      }
    }
  }
  return [...set];
}

export function TurnNode({
  turn,
  depth,
}: {
  turn: UsageTreeTurn;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const models = useMemo(() => collectTurnModels(turn), [turn]);
  const providers = useMemo(() => collectTurnProviders(turn), [turn]);
  const modelFmt = formatStringOwnIncl(turn.modelName, models);
  const provFmt = formatStringOwnIncl(turn.providerName, providers);

  const hasSubagents = turn.inclusive.totalTokens !== turn.own.totalTokens;
  const stepStr = formatOwnIncl(
    turn.stepCount ?? turn.steps.length,
    turn.inclusiveStepCount ?? turn.stepCount ?? turn.steps.length
  );
  const inStr = hasSubagents
    ? `${formatTokens(turn.own.inputTokens)} (${formatTokens(turn.inclusive.inputTokens)}) tok in`
    : `${formatTokens(turn.own.inputTokens)} tok in`;
  const outStr = hasSubagents
    ? `${formatTokens(turn.own.outputTokens)} (${formatTokens(turn.inclusive.outputTokens)}) tok out`
    : `${formatTokens(turn.own.outputTokens)} tok out`;
  const ctxHint =
    turn.contextTurnNumbers.length > 0
      ? `ctx ${turn.contextTurnNumbers.join(",")}`
      : "ctx —";

  const headline = [
    inStr,
    outStr,
    `${stepStr} steps`,
    ctxHint,
    modelFmt.text,
    turn.durationMs != null
      ? turn.inclusiveDurationMs != null && turn.inclusiveDurationMs > turn.durationMs
        ? `${formatDuration(turn.durationMs)} (${formatDuration(turn.inclusiveDurationMs)})`
        : formatDuration(turn.durationMs)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const contextStr =
    turn.contextTurnNumbers.length > 0
      ? turn.contextTurnNumbers.join(", ")
      : "none";

  const detail = (
    <div className="space-y-1">
      <DetailFields
        rows={[
          { label: "Turn ID", value: String(turn.turnId) },
          { label: "Turn #", value: String(turn.turnNumber) },
          ...(turn.agentName ? [{ label: "Agent", value: turn.agentName }] : []),
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
            label: "Steps",
            value: (
              <CountOwnIncl
                own={turn.stepCount ?? turn.steps.length}
                inclusive={turn.inclusiveStepCount}
              />
            ),
          },
          {
            label: "Duration",
            value: (
              <Duration ms={turn.durationMs} inclusiveMs={turn.inclusiveDurationMs} />
            ),
          },
          {
            label: "Status",
            value: (
              <span className="flex items-center gap-1">
                <StatusBadge status={turn.status} />
                {turn.status ?? "—"}
              </span>
            ),
          },
        ]}
      />
      {turn.userContentPreview && (
        <>
          <Divider />
          <div className="text-[10px] text-zinc-400 italic leading-relaxed border-l-2 border-zinc-700/60 pl-2 break-words">
            {turn.userContentPreview}
          </div>
        </>
      )}
      <Divider />
      <DetailFields rows={[{ label: "Context", value: contextStr }]} />
      <Divider />
      <TokenBlock own={turn.own} inclusive={turn.inclusive} />
    </div>
  );

  return (
    <CollapsibleNode
      depth={depth}
      expanded={expanded}
      onToggle={toggle}
      label={`Turn ${turn.turnNumber}`}
      headline={headline}
      detail={detail}
    >
      {turn.steps.map((step) => (
        <StepNode key={step.stepIndex} step={step} depth={depth + 1} />
      ))}
    </CollapsibleNode>
  );
}
