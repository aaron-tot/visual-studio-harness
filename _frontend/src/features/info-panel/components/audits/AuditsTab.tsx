import { useEffect, useState } from "react";
import { useChatStore } from "../../../../stores/chat";
import { useSessionViewStore } from "../../../../stores/sessionView";
import type { DesignLocation, PlanScope } from "../../types";
import { useAudits } from "../../hooks/useAudits";
import { useAuditMutations } from "../../hooks/useAuditMutations";
import { ResultBanner } from "../ui";
import { AuditGroupList } from "./AuditGroupList";
import { AuditPromptsList } from "./AuditPromptsList";

interface AuditsTabProps {
  active: boolean;
  scope: PlanScope;
}

function createLocation(
  scope: PlanScope,
  workspaceRoot: string | null | undefined,
  sessionId: string | null | undefined
): DesignLocation {
  if (scope === "project") return { scope: "project", workspaceRoot: workspaceRoot?.trim() || undefined };
  if (scope === "session") return { scope: "session", sessionId: sessionId || undefined };
  return { scope: "global" };
}

export function AuditsTab({ active, scope }: AuditsTabProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);

  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const chatSessionId = useChatStore((s) => s.sessionId);
  const viewSessionId = useSessionViewStore((s) => s.currentSessionId);
  const currentSessionId = viewSessionId || chatSessionId;

  const { groups, loading, error, refresh } = useAudits({
    scope,
    workspaceRoot,
    currentSessionId,
    enabled: active,
  });

  const mutations = useAuditMutations({
    scope,
    workspaceRoot,
    sessionId: currentSessionId,
    onSuccess: () => void refresh(),
  });

  // Reset expand UI when switching scope tabs
  useEffect(() => {
    setExpandedGroup(null);
    setExpandedAudit(null);
    mutations.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on scope change
  }, [scope]);

  return (
    <>
      <div className="flex-[7] flex flex-col min-h-0 overflow-y-auto">
        <div className="px-3 pt-3 pb-2 border-b border-zinc-800 space-y-1.5">
          <ResultBanner result={mutations.result} />
        </div>

        <AuditGroupList
          flat={scope === "global"}
          groups={groups}
          loading={loading}
          error={error}
          expandedGroup={expandedGroup}
          expandedAudit={expandedAudit}
          onToggleGroup={(key) =>
            setExpandedGroup((prev) => (prev === key ? null : key))
          }
          onToggleAudit={(key) =>
            setExpandedAudit((prev) => (prev === key ? null : key))
          }
          busy={mutations.busy}
          onDelete={(name, loc) => void mutations.remove(name, loc)}
          onSave={(name, doc) => void mutations.edit(name, doc, createLocation(scope, workspaceRoot, currentSessionId))}
        />
      </div>

      <div className="border-t border-zinc-800">
        <AuditPromptsList />
      </div>
    </>
  );
}
