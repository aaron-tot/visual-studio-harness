import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "../../../../stores/chat";
import { useSessionViewStore } from "../../../../stores/sessionView";
import type { DesignLocation, DocMode, PlanScope } from "../../types";
import { usePlans } from "../../hooks/usePlans";
import { usePlanMutations } from "../../hooks/usePlanMutations";
import { useInjectedDocs } from "../../hooks/useInjectedDocs";
import { saveTargetHint } from "../../lib/scope-params";
import { PanelSectionTitle, ResultBanner } from "../ui";
import { ScopeSwitcher } from "./ScopeSwitcher";
import { CreateIdeaForm } from "./CreateIdeaForm";
import { DesignGroupList } from "./DesignGroupList";
import { AuditsSection } from "./AuditsSection";

interface IdeasTabProps {
  /** When false, skip network fetches (panel closed) */
  active: boolean;
}

export function IdeasTab({ active }: IdeasTabProps) {
  const [scope, setScope] = useState<PlanScope>("global");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [endGoal, setEndGoal] = useState("");
  const [abandoningKey, setAbandoningKey] = useState<string | null>(null);
  const [abandonReason, setAbandonReason] = useState("");
  const [abandonSuccessor, setAbandonSuccessor] = useState("");

  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const chatSessionId = useChatStore((s) => s.sessionId);
  const viewSessionId = useSessionViewStore((s) => s.currentSessionId);
  const currentSessionId = viewSessionId || chatSessionId;

  const { groups, loading, error, refresh } = usePlans({
    scope,
    workspaceRoot,
    currentSessionId,
    enabled: active,
  });

  const mutations = usePlanMutations({
    scope,
    workspaceRoot,
    sessionId: currentSessionId,
    onSuccess: () => void refresh(),
  });

  const { isInjected, toggleInject } = useInjectedDocs();

  // Reset expand / abandon UI when switching scope tabs
  useEffect(() => {
    setExpandedGroup(null);
    setExpandedPlan(null);
    setAbandoningKey(null);
    setAbandonReason("");
    setAbandonSuccessor("");
    mutations.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on scope change
  }, [scope]);

  /** Name conflict only against the create target (current location), not all groups. */
  const existingNames = useMemo(() => {
    const names = new Set<string>();
    if (scope === "global") {
      for (const d of groups[0]?.designs ?? []) names.add(d.name);
      return names;
    }
    const current = groups.find((g) => g.isCurrent);
    for (const d of current?.designs ?? []) names.add(d.name);
    return names;
  }, [groups, scope]);

  const nameConflict = !!(createName.trim() && existingNames.has(createName.trim()));

  const handleCreate = async (mode: DocMode) => {
    const ok = await mutations.create(mode, createName, endGoal);
    if (ok) {
      setCreateName("");
      setEndGoal("");
      // Expand current group so the new idea is visible
      if (scope !== "global") {
        const current = groups.find((g) => g.isCurrent);
        if (current) setExpandedGroup(current.key);
      }
    }
  };

  const handleConfirmAbandon = async (planName: string, location: DesignLocation) => {
    const ok = await mutations.abandon(
      planName,
      abandonReason,
      location,
      abandonSuccessor
    );
    if (ok) {
      setAbandoningKey(null);
      setAbandonReason("");
      setAbandonSuccessor("");
    }
  };

  const canCreate =
    scope === "global" ||
    (scope === "project" && !!workspaceRoot?.trim()) ||
    (scope === "session" && !!currentSessionId);

  const targetHint = saveTargetHint(scope, workspaceRoot, currentSessionId);

  return (
    <>
      <div className="flex-[7] flex flex-col min-h-0 overflow-y-auto">
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800 space-y-1.5">
          <PanelSectionTitle>
            <ChevronDown size={12} />
            Plans & Ideas
          </PanelSectionTitle>
          <ScopeSwitcher
            scope={scope}
            onChange={(s) => {
              setScope(s);
            }}
          />
          {targetHint && (
            <div className="text-[9px] text-zinc-600 leading-snug">{targetHint}</div>
          )}
          {canCreate ? (
            <CreateIdeaForm
              createName={createName}
              endGoal={endGoal}
              nameConflict={nameConflict}
              busy={mutations.busy}
              onNameChange={setCreateName}
              onEndGoalChange={setEndGoal}
              onCreate={handleCreate}
            />
          ) : (
            <div className="text-[10px] text-amber-600/90">
              {scope === "project"
                ? "Set a workspace in the chat toolbar to create project ideas."
                : "Open or start a session to create session ideas."}
            </div>
          )}
          <ResultBanner result={mutations.result} />
        </div>

        <DesignGroupList
          flat={scope === "global"}
          groups={groups}
          loading={loading}
          error={error}
          expandedGroup={expandedGroup}
          expandedPlan={expandedPlan}
          onToggleGroup={(key) =>
            setExpandedGroup((prev) => (prev === key ? null : key))
          }
          onTogglePlan={(key) =>
            setExpandedPlan((prev) => (prev === key ? null : key))
          }
          busy={mutations.busy}
          abandoningKey={abandoningKey}
          abandonReason={abandonReason}
          abandonSuccessor={abandonSuccessor}
          onAbandonReason={setAbandonReason}
          onAbandonSuccessor={setAbandonSuccessor}
          onStartAbandon={(key) => {
            setAbandoningKey(key);
          }}
          onCancelAbandon={() => {
            setAbandoningKey(null);
            setAbandonReason("");
            setAbandonSuccessor("");
          }}
          onConfirmAbandon={handleConfirmAbandon}
          onDelete={(name, loc) => void mutations.deleteIdea(name, loc)}
          onArchive={(name, loc) => void mutations.archiveIdea(name, loc)}
          onAddVersion={(name, mode, loc) =>
            void mutations.addVersion(name, mode, loc)
          }
          isInjected={isInjected}
          onToggleInject={toggleInject}
          onResult={mutations.setResult}
        />
      </div>

      <div className="h-px bg-zinc-800 shrink-0" />
      <AuditsSection />
    </>
  );
}
