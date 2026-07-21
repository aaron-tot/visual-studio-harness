import type { PlanEntry } from "../../../../lib/api";
import type { DocMode, InjectSub } from "../../types";
import { latestDocContent, stageForChat } from "../../lib/stage-for-chat";
import { MiniAction } from "../ui";

interface PlanActionsProps {
  plan: PlanEntry;
  isInjected: (mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
}

function DocRow({
  label,
  mode,
  plan,
  isInjected,
  onToggleInject,
  onResult,
}: {
  label: string;
  mode: DocMode;
  plan: PlanEntry;
  isInjected: (mode: DocMode, sub: InjectSub) => boolean;
  onToggleInject: (mode: DocMode, sub: InjectSub) => void;
  onResult: (msg: string) => void;
}) {
  const docs = mode === "spec" ? plan.specs : plan.plans;
  if (docs.length === 0) return null;

  const stage = (sub: InjectSub, e: React.MouseEvent) => {
    const content = latestDocContent(docs, plan.name, mode, sub);
    if (!content) return;
    onResult(stageForChat(content, e));
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-zinc-600 w-[70px] shrink-0">Add to msg</span>
        <div className="flex gap-0.5">
          <span className="text-[9px] text-zinc-500 mr-0.5">{label}</span>
          <MiniAction onClick={(e) => stage("full", e)}>Full</MiniAction>
          <MiniAction onClick={(e) => stage("path", e)}>Path</MiniAction>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-zinc-600 w-[70px] shrink-0">Inject sys</span>
        <div className="flex gap-0.5">
          <span className="text-[9px] text-zinc-500 mr-0.5">{label}</span>
          <MiniAction
            active={isInjected(mode, "full")}
            onClick={() => onToggleInject(mode, "full")}
          >
            Full
          </MiniAction>
          <MiniAction
            active={isInjected(mode, "path")}
            onClick={() => onToggleInject(mode, "path")}
          >
            Path
          </MiniAction>
        </div>
      </div>
    </>
  );
}

export function PlanActions({
  plan,
  isInjected,
  onToggleInject,
  onResult,
}: PlanActionsProps) {
  if (plan.specs.length === 0 && plan.plans.length === 0) return null;

  return (
    <div className="pt-1 pb-1.5 border-b border-zinc-800 space-y-1">
      <DocRow
        label="S"
        mode="spec"
        plan={plan}
        isInjected={isInjected}
        onToggleInject={onToggleInject}
        onResult={onResult}
      />
      <DocRow
        label="P"
        mode="plan"
        plan={plan}
        isInjected={isInjected}
        onToggleInject={onToggleInject}
        onResult={onResult}
      />
    </div>
  );
}
