import { useCallback } from "react";
import type { PlanEntry } from "../../../lib/api";
import { useSessionViewStore } from "../../../stores/sessionView";
import type { DocMode, InjectSub } from "../types";
import { injectKey } from "../types";
import { latestDocContent } from "../lib/stage-for-chat";

/**
 * System-prompt inject state is sessionView.sessionContext (single source of truth).
 * No parallel localStorage map — avoids desync with ContextBar removals.
 */
export function useInjectedDocs() {
  const sessionContext = useSessionViewStore((s) => s.sessionContext);
  const addContext = useSessionViewStore((s) => s.addContext);
  const removeContext = useSessionViewStore((s) => s.removeContext);

  const isInjected = useCallback(
    (planName: string, mode: DocMode, sub: InjectSub) => {
      const key = injectKey(planName, mode, sub);
      return sessionContext.some((c) => c.id === key);
    },
    [sessionContext]
  );

  const toggleInject = useCallback(
    (plan: PlanEntry, mode: DocMode, sub: InjectSub) => {
      const key = injectKey(plan.name, mode, sub);
      if (sessionContext.some((c) => c.id === key)) {
        removeContext(key);
        return;
      }
      const docs = mode === "spec" ? plan.specs : plan.plans;
      const content = latestDocContent(docs, plan.name, mode, sub);
      if (!content) return;
      addContext({
        id: key,
        type: mode,
        planName: plan.name,
        version: docs.length,
        label: `${mode === "spec" ? "Spec" : "Plan"}: ${plan.name}/v${docs.length}`,
        content,
      });
    },
    [sessionContext, addContext, removeContext]
  );

  return { isInjected, toggleInject, sessionContext };
}
