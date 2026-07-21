import { useCallback, useState } from "react";
import { FAKE_USAGE_TREE } from "../../fake/fake-usage-data";
import type {
  FAKE_UsageSession,
  FAKE_UsageTurn,
  FAKE_UsageStep,
  FAKE_SubagentRef,
} from "../../fake/fake-usage-data";
import { UsageNodeRow } from "./UsageNodeRow";
import {
  formatDuration,
  formatTokenFlow,
  formatOwnIncl,
  formatNumOwnIncl,
  formatDurationOwnIncl,
  formatStringOwnInclParts,
} from "./format";

// ── Inclusive rollups (own + nested subagent sessions) ─────────────────

type TokenSlice = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
};

function addSlice(a: TokenSlice, b: TokenSlice): TokenSlice {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

function ownFromSession(s: FAKE_UsageSession): TokenSlice {
  return {
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    reasoningTokens: s.reasoningTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheWriteTokens: s.cacheWriteTokens,
    durationMs: s.durationMs,
  };
}

function ownFromTurn(t: FAKE_UsageTurn): TokenSlice {
  return {
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    totalTokens: t.totalTokens,
    reasoningTokens: t.reasoningTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheWriteTokens: t.cacheWriteTokens,
    durationMs: t.durationMs,
  };
}

function ownFromStep(s: FAKE_UsageStep): TokenSlice {
  return {
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    reasoningTokens: s.reasoningTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheWriteTokens: s.cacheWriteTokens,
    durationMs: s.stepTimeMs,
  };
}

function inclusiveSession(session: FAKE_UsageSession): TokenSlice {
  let acc = ownFromSession(session);
  for (const turn of session.turns) {
    for (const step of turn.steps) {
      if (step.subagent) acc = addSlice(acc, inclusiveSession(step.subagent.session));
    }
  }
  return acc;
}

function inclusiveTurn(turn: FAKE_UsageTurn): TokenSlice {
  let acc = ownFromTurn(turn);
  for (const step of turn.steps) {
    if (step.subagent) acc = addSlice(acc, inclusiveSession(step.subagent.session));
  }
  return acc;
}

function inclusiveStep(step: FAKE_UsageStep): TokenSlice {
  let acc = ownFromStep(step);
  if (step.subagent) acc = addSlice(acc, inclusiveSession(step.subagent.session));
  return acc;
}

/** Own turn count + all nested subagent session turns (recursive). */
function countInclusiveTurns(session: FAKE_UsageSession): number {
  let n = session.turnCount;
  for (const turn of session.turns) {
    for (const step of turn.steps) {
      if (step.subagent) n += countInclusiveTurns(step.subagent.session);
    }
  }
  return n;
}

/** Own step count + all nested subagent session steps (recursive). */
function countInclusiveSteps(session: FAKE_UsageSession): number {
  let n = session.stepCount;
  for (const turn of session.turns) {
    for (const step of turn.steps) {
      if (step.subagent) n += countInclusiveSteps(step.subagent.session);
    }
  }
  return n;
}

/** Steps on this turn + steps inside any subagent spawned from this turn. */
function countInclusiveStepsForTurn(turn: FAKE_UsageTurn): number {
  let n = turn.stepCount;
  for (const step of turn.steps) {
    if (step.subagent) n += countInclusiveSteps(step.subagent.session);
  }
  return n;
}

// ── Collect nested string values (model / provider) ────────────────────

function collectTurnModels(turn: FAKE_UsageTurn): string[] {
  const set = new Set<string>();
  if (turn.modelName) set.add(turn.modelName);
  for (const step of turn.steps) {
    if (step.modelId) set.add(step.modelId);
    if (step.responseModelId) set.add(step.responseModelId);
    if (step.subagent) {
      for (const v of collectSessionModels(step.subagent.session)) set.add(v);
    }
  }
  return [...set];
}

function collectTurnProviders(turn: FAKE_UsageTurn): string[] {
  const set = new Set<string>();
  if (turn.providerName) set.add(turn.providerName);
  for (const step of turn.steps) {
    if (step.providerName) set.add(step.providerName);
    if (step.subagent) {
      for (const v of collectSessionProviders(step.subagent.session)) set.add(v);
    }
  }
  return [...set];
}

function collectSessionModels(session: FAKE_UsageSession): string[] {
  const set = new Set<string>();
  for (const t of session.turns) {
    for (const v of collectTurnModels(t)) set.add(v);
  }
  return [...set];
}

function collectSessionProviders(session: FAKE_UsageSession): string[] {
  const set = new Set<string>();
  for (const t of session.turns) {
    for (const v of collectTurnProviders(t)) set.add(v);
  }
  return [...set];
}

// ── UI primitives ──────────────────────────────────────────────────────

function statusColor(status: string) {
  if (status === "success") return "text-emerald-400";
  if (status === "error") return "text-red-400";
  if (status === "streaming") return "text-amber-400";
  return "text-zinc-500";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[9px] uppercase tracking-wider ${statusColor(status)}`}>
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0 py-[1px]">
      <span className="text-[9px] text-zinc-600 uppercase tracking-wider shrink-0">{label}</span>
      {/* no truncate — () must stay visible on the right */}
      <span className="text-[10px] text-zinc-300 text-right break-all">{children}</span>
    </div>
  );
}

/**
 * Model/provider style: `claude` | `claude (google)` | `claude (many)`.
 * Hover lists every value (main + nested).
 */
function MultiValueField({
  label,
  primary,
  values,
}: {
  label: string;
  /** Own / main value for this node (outside the parens). */
  primary?: string;
  values: string[];
}) {
  const { text, title } = formatStringOwnInclParts(primary, values);
  return (
    <Field label={label}>
      <span title={title} className={title ? "cursor-help border-b border-dotted border-zinc-600" : undefined}>
        {text}
      </span>
    </Field>
  );
}

function NumField({
  label,
  own,
  inclusive,
}: {
  label: string;
  own: number;
  inclusive: number;
}) {
  return <Field label={label}>{formatNumOwnIncl(own, inclusive)}</Field>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="text-[8px] text-zinc-700 uppercase tracking-widest mb-1 px-0.5 flex items-center gap-1.5">
        <span className="w-1 h-1 rounded-full bg-zinc-700 inline-block" />
        {title}
      </div>
      <div className="border-l border-zinc-800/50 pl-2.5">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-zinc-800/40 mx-0.5 my-2" />;
}

function TokenFields({ own, incl }: { own: TokenSlice; incl: TokenSlice }) {
  return (
    <Section title="Tokens">
      <NumField label="Input" own={own.inputTokens} inclusive={incl.inputTokens} />
      <NumField label="Output" own={own.outputTokens} inclusive={incl.outputTokens} />
      <NumField label="Total" own={own.totalTokens} inclusive={incl.totalTokens} />
      <NumField label="Reasoning" own={own.reasoningTokens} inclusive={incl.reasoningTokens} />
      <NumField label="Cache Read" own={own.cacheReadTokens} inclusive={incl.cacheReadTokens} />
      <NumField label="Cache Write" own={own.cacheWriteTokens} inclusive={incl.cacheWriteTokens} />
    </Section>
  );
}

// ── Detail panels ──────────────────────────────────────────────────────

function SessionDetail({ session }: { session: FAKE_UsageSession }) {
  const own = ownFromSession(session);
  const incl = inclusiveSession(session);
  // Prefer larger of fixture vs computed so () always show when nested work exists
  const inclTotal = Math.max(incl.totalTokens, session.inclusiveTotalTokens);
  const inclMerged = { ...incl, totalTokens: inclTotal };
  const models = collectSessionModels(session);
  const providers = collectSessionProviders(session);
  const primaryModel = session.turns[0]?.modelName ?? models[0];
  const primaryProvider = session.turns[0]?.providerName ?? providers[0];

  return (
    <div className="px-1 pb-1">
      <Section title="Identity">
        <Field label="Session ID">
          <span className="font-mono text-[9px] text-zinc-500">{session.sessionId}</span>
        </Field>
        <MultiValueField label="Model" primary={primaryModel} values={models} />
        <MultiValueField label="Provider" primary={primaryProvider} values={providers} />
      </Section>
      <TokenFields own={own} incl={inclMerged} />
      <Section title="Summary">
        <NumField
          label="Turns"
          own={session.turnCount}
          inclusive={countInclusiveTurns(session)}
        />
        <NumField
          label="Steps"
          own={session.stepCount}
          inclusive={countInclusiveSteps(session)}
        />
        <Field label="Duration">
          {formatDurationOwnIncl(own.durationMs, incl.durationMs)}
        </Field>
      </Section>
    </div>
  );
}

function TurnDetail({ turn }: { turn: FAKE_UsageTurn }) {
  const own = ownFromTurn(turn);
  const incl = inclusiveTurn(turn);
  const inclMerged = {
    ...incl,
    totalTokens: Math.max(incl.totalTokens, turn.inclusiveTotalTokens),
  };
  const models = collectTurnModels(turn);
  const providers = collectTurnProviders(turn);
  const ctx =
    turn.contextTurnNumbers.length > 0
      ? turn.contextTurnNumbers.map(String).join(", ")
      : "none";
  const inclSteps = countInclusiveStepsForTurn(turn);

  return (
    <div className="px-1 pb-1">
      <div className="text-[10px] text-zinc-400 italic leading-relaxed border-l-2 border-zinc-700/60 pl-2 mb-2.5 break-words">
        {turn.userContentPreview}
      </div>
      <Section title="Identity">
        <Field label="Turn ID">
          <span className="font-mono text-[9px] text-zinc-500">{turn.turnId}</span>
        </Field>
        <Field label="Turn #">{String(turn.turnNumber)}</Field>
        <Field label="Agent">{turn.agentName}</Field>
        <MultiValueField label="Model" primary={turn.modelName} values={models} />
        <MultiValueField label="Provider" primary={turn.providerName} values={providers} />
      </Section>
      <Section title="Context">
        <Field label="Input turns">{ctx}</Field>
      </Section>
      <TokenFields own={own} incl={inclMerged} />
      <Section title="Performance">
        <Field label="Duration">
          {formatDurationOwnIncl(own.durationMs, incl.durationMs)}
        </Field>
        <NumField label="Steps" own={turn.stepCount} inclusive={inclSteps} />
        <Field label="Status">
          <StatusBadge status={turn.status} />
        </Field>
        <Field label="Finish Reason">{turn.finishReason}</Field>
      </Section>
      {turn.errorMessage && (
        <>
          <Divider />
          <Section title="Error">
            <div className="text-[10px] text-red-400 leading-relaxed break-words">
              {turn.errorMessage}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function StepDetail({ step }: { step: FAKE_UsageStep }) {
  const own = ownFromStep(step);
  const incl = inclusiveStep(step);
  const inclMerged = {
    ...incl,
    totalTokens: Math.max(incl.totalTokens, step.inclusiveTotalTokens),
  };
  const models = step.subagent
    ? [step.modelId, step.responseModelId, ...collectSessionModels(step.subagent.session)]
    : [step.modelId, step.responseModelId];
  const providers = step.subagent
    ? [step.providerName, ...collectSessionProviders(step.subagent.session)]
    : [step.providerName];
  const modelList = models.filter(Boolean) as string[];
  const providerList = providers.filter(Boolean) as string[];

  return (
    <div className="px-1 pb-1">
      <TokenFields own={own} incl={inclMerged} />
      <Section title="Performance">
        <Field label="Step Time">{formatDuration(step.stepTimeMs)}</Field>
        <Field label="Response Time">{formatDuration(step.responseTimeMs)}</Field>
        <Field label="TTFT">{formatDuration(step.timeToFirstOutputMs)}</Field>
        <Field label="Output TPS">{step.outputTps.toFixed(1)}</Field>
        <Field label="Input TPS">{step.inputTps.toFixed(1)}</Field>
        <Field label="Eff. Output TPS">{step.effectiveOutputTps.toFixed(1)}</Field>
      </Section>
      <Section title="Details">
        <Field label="Finish Reason">{step.finishReason}</Field>
        <Field label="Raw Finish">{step.rawFinishReason}</Field>
        <MultiValueField label="Model" primary={step.modelId} values={modelList} />
        <MultiValueField label="Provider" primary={step.providerName} values={providerList} />
        <Field label="Response ID">
          <span className="font-mono text-[9px] text-zinc-500">{step.responseId}</span>
        </Field>
      </Section>
    </div>
  );
}

// ── Tree nodes ─────────────────────────────────────────────────────────

function UsageTurnView({
  turn,
  expanded,
  onToggle,
  depth = 1,
}: {
  turn: FAKE_UsageTurn;
  expanded: boolean;
  onToggle: () => void;
  depth?: number;
}) {
  const ctxHint =
    turn.contextTurnNumbers.length > 0
      ? `ctx ${turn.contextTurnNumbers.join(",")}`
      : "ctx —";

  const label = (
    <span className="flex items-center gap-1.5">
      <StatusBadge status={turn.status} />
      <span>Turn {turn.turnNumber}</span>
    </span>
  );
  // Prefer fixture inclusive; also fold nested subagent totals
  const inclTok = Math.max(
    turn.inclusiveTotalTokens ?? 0,
    inclusiveTurn(turn).totalTokens,
    turn.totalTokens
  );
  const models = collectTurnModels(turn);
  const providers = collectTurnProviders(turn);
  const modelFmt = formatStringOwnInclParts(turn.modelName, models);
  const provFmt = formatStringOwnInclParts(turn.providerName, providers);
  const tokStr = formatOwnIncl(turn.totalTokens, inclTok);

  const headline = (
    <span className="flex items-center gap-1 flex-wrap">
      {/* tokens first so own (incl) is never clipped off the end */}
      <span className="text-zinc-300 font-medium whitespace-nowrap shrink-0">{tokStr}</span>
      <span className="text-zinc-600">·</span>
      <span className="font-mono text-[9px] text-zinc-600 truncate max-w-[72px]" title={turn.turnId}>
        {turn.turnId}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-600 whitespace-nowrap">{ctxHint}</span>
      <span className="text-zinc-600">·</span>
      <span className="truncate max-w-[80px] text-zinc-400">{turn.userContentPreview}</span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={modelFmt.title}>
        {modelFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={provFmt.title}>
        {provFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{turn.stepCount} steps</span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">
        {formatDurationOwnIncl(
          turn.durationMs,
          Math.max(turn.durationMs, inclusiveTurn(turn).durationMs)
        )}
      </span>
    </span>
  );

  return (
    <UsageNodeRow
      depth={depth}
      expanded={expanded}
      onToggle={onToggle}
      label={label}
      headline={headline}
      detail={<TurnDetail turn={turn} />}
    >
      {turn.steps.map((step) => (
        <UsageStepView
          key={`step:${turn.turnId}:${step.stepIndex}`}
          step={step}
          depth={depth + 1}
        />
      ))}
    </UsageNodeRow>
  );
}

function UsageStepView({ step, depth }: { step: FAKE_UsageStep; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const incl = inclusiveStep(step);
  const inclTok = Math.max(
    step.inclusiveTotalTokens ?? 0,
    incl.totalTokens,
    step.totalTokens
  );
  const models = step.subagent
    ? [step.modelId, ...collectSessionModels(step.subagent.session)].filter(Boolean)
    : [step.modelId].filter(Boolean);
  const providers = step.subagent
    ? [step.providerName, ...collectSessionProviders(step.subagent.session)].filter(Boolean)
    : [step.providerName].filter(Boolean);
  const modelFmt = formatStringOwnInclParts(step.modelId, models);
  const provFmt = formatStringOwnInclParts(step.providerName, providers);
  const tokStr = formatOwnIncl(step.totalTokens, inclTok);

  const label = (
    <span className="flex items-center gap-1.5">
      <StatusBadge status={step.status} />
      <span>Step {step.stepIndex}</span>
    </span>
  );
  const headline = (
    <span className="flex items-center gap-1 flex-wrap">
      <span className="text-zinc-300 font-medium whitespace-nowrap shrink-0">{tokStr}</span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{formatTokenFlow(step.inputTokens, step.outputTokens)}</span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={modelFmt.title}>
        {modelFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={provFmt.title}>
        {provFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{formatDuration(step.stepTimeMs)}</span>
      <span className="text-zinc-600">·</span>
      <span>{step.finishReason}</span>
    </span>
  );

  return (
    <UsageNodeRow
      depth={depth}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      label={label}
      headline={headline}
      detail={<StepDetail step={step} />}
    >
      {expanded && step.subagent && (
        <div className="border-l border-zinc-800/60 ml-5">
          <UsageSubagentView ref_={step.subagent} />
        </div>
      )}
    </UsageNodeRow>
  );
}

function UsageSessionBody({
  session,
  expanded,
  onToggle,
  depth = 1,
}: {
  session: FAKE_UsageSession;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  depth?: number;
}) {
  return session.turns.map((turn) => {
    const turnKey = `turn:${turn.turnId}`;
    return (
      <UsageTurnView
        key={turnKey}
        turn={turn}
        depth={depth}
        expanded={expanded.has(turnKey)}
        onToggle={() => onToggle(turnKey)}
      />
    );
  });
}

function UsageSubagentView({ ref_ }: { ref_: FAKE_SubagentRef }) {
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const child = ref_.session;
  const incl = inclusiveSession(child);

  const localToggle = useCallback((key: string) => {
    setLocalExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const label = (
    <span className="flex items-center gap-1.5">
      <span className="text-[10px] text-zinc-500">subagent</span>
      <span className="text-xs font-medium text-zinc-200">{ref_.taskLabel}</span>
    </span>
  );
  const childInclTok = Math.max(
    child.inclusiveTotalTokens ?? 0,
    incl.totalTokens,
    child.totalTokens
  );
  const tokStr = formatOwnIncl(child.totalTokens, childInclTok);
  const headline = (
    <span className="flex items-center gap-1 flex-wrap">
      <span className="text-zinc-300 font-medium whitespace-nowrap shrink-0">{tokStr}</span>
      <span className="text-zinc-600">·</span>
      <span className="font-mono text-[9px] text-zinc-600 truncate max-w-[90px]" title={child.sessionId}>
        {child.sessionId}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="truncate max-w-[70px] text-zinc-400">{child.label}</span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{formatDuration(child.durationMs)}</span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{child.turnCount} turns</span>
    </span>
  );

  return (
    <UsageNodeRow
      depth={0}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      label={label}
      headline={headline}
      detail={<SessionDetail session={child} />}
    >
      <UsageSessionBody
        session={child}
        expanded={localExpanded}
        onToggle={localToggle}
        depth={1}
      />
    </UsageNodeRow>
  );
}

export function UsageTree() {
  const session = FAKE_USAGE_TREE;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["session"]));
  const incl = inclusiveSession(session);
  const inclTok = Math.max(
    session.inclusiveTotalTokens ?? 0,
    incl.totalTokens,
    session.totalTokens
  );
  const models = collectSessionModels(session);
  const providers = collectSessionProviders(session);
  const primaryModel = session.turns[0]?.modelName;
  const primaryProvider = session.turns[0]?.providerName;
  const modelFmt = formatStringOwnInclParts(primaryModel, models);
  const provFmt = formatStringOwnInclParts(primaryProvider, providers);
  const tokStr = formatOwnIncl(session.totalTokens, inclTok);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const sessionLabel = (
    <span className="flex items-center gap-2">
      <StatusBadge status="success" />
      <span className="text-sm font-semibold text-zinc-100">{session.label}</span>
    </span>
  );
  const sessionHeadline = (
    <span className="flex items-center gap-1 flex-wrap">
      <span className="text-zinc-300 font-medium whitespace-nowrap shrink-0">{tokStr}</span>
      <span className="text-zinc-600">·</span>
      <span className="font-mono text-[9px] text-zinc-600 truncate max-w-[100px]" title={session.sessionId}>
        {session.sessionId}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">{session.turnCount} turns</span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={modelFmt.title}>
        {modelFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="text-zinc-400 whitespace-nowrap" title={provFmt.title}>
        {provFmt.text}
      </span>
      <span className="text-zinc-600">·</span>
      <span className="whitespace-nowrap">
        {formatDurationOwnIncl(session.durationMs, incl.durationMs)}
      </span>
    </span>
  );

  return (
    <div className="pb-2">
      <UsageNodeRow
        depth={0}
        expanded={expanded.has("session")}
        onToggle={() => toggle("session")}
        label={sessionLabel}
        headline={sessionHeadline}
        detail={<SessionDetail session={session} />}
      >
        <UsageSessionBody session={session} expanded={expanded} onToggle={toggle} />
      </UsageNodeRow>
    </div>
  );
}
