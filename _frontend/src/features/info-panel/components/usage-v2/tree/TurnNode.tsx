import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
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
import { getUsageTreeTurnSteps } from "../../../../../lib/api";
import type { UsageTreeTurn, UsageTreeStep } from "../types";

function collectTurnModels(turn: UsageTreeTurn, steps: UsageTreeStep[]): string[] {
  const set = new Set<string>();
  if (turn.modelName) set.add(turn.modelName);
  for (const s of steps) {
    if (s.modelId) set.add(s.modelId);
    for (const sa of s.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.modelName) set.add(t.modelName);
          for (const st of t.steps ?? []) if (st.modelId) set.add(st.modelId);
        }
      }
    }
  }
  return [...set];
}

function collectTurnProviders(turn: UsageTreeTurn, steps: UsageTreeStep[]): string[] {
  const set = new Set<string>();
  if (turn.providerName) set.add(turn.providerName);
  for (const s of steps) {
    if (s.providerName) set.add(s.providerName);
    for (const sa of s.subagents ?? []) {
      if (sa.child) {
        for (const t of sa.child.turns) {
          if (t.providerName) set.add(t.providerName);
          for (const st of t.steps ?? []) if (st.providerName) set.add(st.providerName);
        }
      }
    }
  }
  return [...set];
}

export function TurnNode({
  turn,
  depth,
  sessionId,
}: {
  turn: UsageTreeTurn;
  depth: number;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [steps, setSteps] = useState<UsageTreeStep[] | undefined>(
    turn.steps && turn.steps.length > 0 ? turn.steps : undefined
  );
  const [loadingSteps, setLoadingSteps] = useState(false);
  const stepsLoadedFor = useRef<number | undefined>(turn.stepCount);
  const reqRef = useRef(0);

  const loadSteps = useCallback(
    async (turnRef: UsageTreeTurn) => {
      const reqId = ++reqRef.current;
      setLoadingSteps(true);
      try {
        const res = await getUsageTreeTurnSteps(sessionId, turnRef.turnNumber);
        if (reqId !== reqRef.current) return;
        const s = res.turn?.steps ?? [];
        setSteps(s);
        stepsLoadedFor.current = turnRef.stepCount;
      } catch {
        if (reqId !== reqRef.current) return;
        setSteps([]);
        stepsLoadedFor.current = turnRef.stepCount;
      } finally {
        if (reqId === reqRef.current) setLoadingSteps(false);
      }
    },
    [sessionId]
  );

  const toggle = useCallback(() => {
    setExpanded((e) => {
      const next = !e;
      if (next && steps == null) {
        stepsLoadedFor.current = turn.stepCount;
        loadSteps(turn);
      }
      return next;
    });
  }, [steps, loadSteps, turn]);

  // Refresh: if this turn is expanded and its visible stepCount changed since we
  // loaded steps (a step finished), invalidate and lazily refetch. Do not refetch
  // every open turn on every refresh — only when that turn's own count changed.
  useEffect(() => {
    if (!expanded || steps == null) return;
    if (turn.stepCount != null && stepsLoadedFor.current != null && stepsLoadedFor.current !== turn.stepCount) {
      loadSteps(turn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, turn.stepCount]);

  const effectiveSteps = steps ?? [];
  const models = useMemo(() => collectTurnModels(turn, effectiveSteps), [turn, effectiveSteps]);
  const providers = useMemo(() => collectTurnProviders(turn, effectiveSteps), [turn, effectiveSteps]);
  const modelFmt = formatStringOwnIncl(turn.modelName, models);
  const provFmt = formatStringOwnIncl(turn.providerName, providers);

  const hasSubagents = turn.inclusive.totalTokens !== turn.own.totalTokens;
  const stepStr = formatOwnIncl(
    turn.stepCount ?? effectiveSteps.length,
    turn.inclusiveStepCount ?? turn.stepCount ?? effectiveSteps.length
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
                own={turn.stepCount ?? effectiveSteps.length}
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
      {loadingSteps ? (
        <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-zinc-500">
          <Loader2 size={12} className="animate-spin" />
          Loading steps…
        </div>
      ) : (
        effectiveSteps.map((step) => (
          <StepNode key={step.stepIndex} step={step} depth={depth + 1} sessionId={sessionId} turnNumber={Number(turn.turnNumber)} />
        ))
      )}
    </CollapsibleNode>
  );
}
