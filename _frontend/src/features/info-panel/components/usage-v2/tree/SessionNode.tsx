import { useState, useCallback, useMemo } from "react";
import { CollapsibleNode } from "../collapsible";
import { TurnNode } from "./TurnNode";
import {
  DetailFields,
  TokenBlock,
  Divider,
  Duration,
  CountOwnIncl,
} from "./detail/DetailFields";
import { formatOwnIncl, formatStringOwnIncl, formatDuration } from "../format/format";
import type { UsageTreeSession } from "../types";

function collectSessionModels(session: UsageTreeSession): string[] {
  const set = new Set<string>();
  for (const t of session.turns) {
    if (t.modelName) set.add(t.modelName);
    for (const s of t.steps) {
      if (s.modelId) set.add(s.modelId);
      for (const sa of s.subagents ?? []) {
        if (sa.child) {
          for (const m of collectSessionModels(sa.child)) set.add(m);
        }
      }
    }
  }
  return [...set];
}

function collectSessionProviders(session: UsageTreeSession): string[] {
  const set = new Set<string>();
  for (const t of session.turns) {
    if (t.providerName) set.add(t.providerName);
    for (const s of t.steps) {
      if (s.providerName) set.add(s.providerName);
      for (const sa of s.subagents ?? []) {
        if (sa.child) {
          for (const p of collectSessionProviders(sa.child)) set.add(p);
        }
      }
    }
  }
  return [...set];
}

export function SessionNode({
  session,
  depth = 0,
}: {
  session: UsageTreeSession;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const models = useMemo(() => collectSessionModels(session), [session]);
  const providers = useMemo(() => collectSessionProviders(session), [session]);
  const primaryModel = session.turns[0]?.modelName ?? models[0];
  const primaryProvider = session.turns[0]?.providerName ?? providers[0];
  const modelFmt = formatStringOwnIncl(primaryModel, models);
  const provFmt = formatStringOwnIncl(primaryProvider, providers);

  const turnStr = formatOwnIncl(
    session.turnCount ?? session.turns.length,
    session.inclusiveTurnCount ?? session.turnCount ?? session.turns.length
  );
  const stepStr = formatOwnIncl(
    session.stepCount ?? 0,
    session.inclusiveStepCount ?? session.stepCount ?? 0
  );
  const tokStr = formatOwnIncl(
    session.own.totalTokens,
    session.inclusive.totalTokens,
    "tok"
  );
  const durStr =
    session.durationMs != null
      ? session.inclusiveDurationMs != null &&
        session.inclusiveDurationMs > session.durationMs
        ? `${formatDuration(session.durationMs)} (${formatDuration(session.inclusiveDurationMs)})`
        : formatDuration(session.durationMs)
      : null;

  const headline = [tokStr, `${turnStr} turns`, `${stepStr} steps`, durStr, modelFmt.text]
    .filter(Boolean)
    .join(" · ");

  const detail = (
    <div className="space-y-1">
      <DetailFields
        rows={[
          { label: "Session ID", value: session.sessionId },
          {
            label: "Turns",
            value: (
              <CountOwnIncl
                own={session.turnCount ?? session.turns.length}
                inclusive={session.inclusiveTurnCount}
              />
            ),
          },
          {
            label: "Steps",
            value: (
              <CountOwnIncl
                own={session.stepCount ?? 0}
                inclusive={session.inclusiveStepCount}
              />
            ),
          },
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
          ...(session.durationMs != null
            ? [
                {
                  label: "Duration",
                  value: (
                    <Duration
                      ms={session.durationMs}
                      inclusiveMs={session.inclusiveDurationMs}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      <Divider />
      <TokenBlock own={session.own} inclusive={session.inclusive} />
    </div>
  );

  return (
    <CollapsibleNode
      depth={depth}
      expanded={expanded}
      onToggle={toggle}
      label={session.label ?? "Session"}
      headline={headline}
      detail={detail}
    >
      {session.turns.map((turn) => (
        <TurnNode key={String(turn.turnId)} turn={turn} depth={depth + 1} />
      ))}
    </CollapsibleNode>
  );
}
