import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "../../../../stores/chat";
import { useSessionViewStore } from "../../../../stores/sessionView";
import type { PlanScope } from "../../types";
import { useAudits } from "../../hooks/useAudits";
import { useAuditMutations } from "../../hooks/useAuditMutations";
import { PanelSectionTitle, ResultBanner } from "../ui";
import { ScopeSwitcher } from "../ideas/ScopeSwitcher";
import { AuditGroupList } from "./AuditGroupList";
import { AuditPromptsList } from "./AuditPromptsList";

interface AuditsTabProps {
  active: boolean;
}

export function AuditsTab({ active }: AuditsTabProps) {
  const [scope, setScope] = useState<PlanScope>("global");
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
          <PanelSectionTitle>
            <ChevronDown size={12} />
            Audits
          </PanelSectionTitle>
          <ScopeSwitcher
            scope={scope}
            onChange={(s) => {
              setScope(s);
            }}
          />
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
        />
      </div>

      <div className="border-t border-zinc-800">
        <AuditPromptsList />
      </div>
    </>
  );
}
