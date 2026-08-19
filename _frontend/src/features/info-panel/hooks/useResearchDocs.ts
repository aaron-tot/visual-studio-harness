import { useCallback, useEffect, useState } from "react";
import { listResearch, listResearchBatched, listWorkspaces } from "../../../lib/api";
import { useSessionStore } from "../../sessions/store";
import type { ResearchGroup, PlanScope } from "../types";
import { workspaceLabel } from "../types";

interface UseResearchDocsOptions {
  scope: PlanScope;
  workspaceRoot: string | null | undefined;
  currentSessionId: string | null | undefined;
  enabled?: boolean;
}

export function useResearchDocs({
  scope,
  workspaceRoot,
  currentSessionId,
  enabled = true,
}: UseResearchDocsOptions) {
  const [groups, setGroups] = useState<ResearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sidebar already fetched the session list — read it instead of an extra round-trip.
  const storeSessions = useSessionStore((s) => s.sessions);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    setGroups([]);
    try {
      if (scope === "global") {
        const docs = await listResearch({ scope: "global" });
        setGroups([
          {
            key: "global",
            label: "Global",
            isCurrent: true,
            docs,
            location: { scope: "global" },
          },
        ]);
        return;
      }

      if (scope === "project") {
        const current = workspaceRoot?.trim() || "";
        const wsList = await listWorkspaces();
        const roots = new Set<string>();
        if (current) roots.add(current);
        for (const w of wsList.workspaces) {
          if (w?.trim()) roots.add(w.trim());
        }

        const batchResult = await listResearchBatched({
          scope: "project",
          workspaceRoots: [...roots],
        });

        const loaded = [...roots].map((root) => ({
          key: `project:${root}`,
          label: workspaceLabel(root),
          isCurrent: !!current && root === current,
          docs: batchResult[root] || [],
          location: { scope: "project" as const, workspaceRoot: root },
        }));

        const currentGroup = loaded.find((g) => g.isCurrent);
        const others = loaded
          .filter((g) => !g.isCurrent && g.docs.length > 0)
          .sort((a, b) => a.label.localeCompare(b.label));

        const next: ResearchGroup[] = [];
        if (currentGroup) next.push(currentGroup);
        for (const g of others) next.push(g);
        setGroups(next);
        return;
      }

      // session scope
      const sessionList = storeSessions;
      const byId = new Map(sessionList.map((s) => [s.id, s]));
      const ids = new Set<string>();
      if (currentSessionId) ids.add(currentSessionId);
      for (const s of sessionList) ids.add(s.id);

      const batchResult = await listResearchBatched({
        scope: "session",
        sessionIds: [...ids],
      });

      const loaded = [...ids].map((sid) => {
        const meta = byId.get(sid);
        const title = meta?.title?.trim() || sid;
        return {
          key: `session:${sid}`,
          label: title,
          isCurrent: sid === currentSessionId,
          docs: batchResult[sid] || [],
          location: { scope: "session" as const, sessionId: sid },
        };
      });

      const currentGroup = loaded.find((g) => g.isCurrent);
      const others = loaded
        .filter((g) => !g.isCurrent && g.docs.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label));

      const next: ResearchGroup[] = [];
      if (currentGroup) next.push(currentGroup);
      for (const g of others) next.push(g);
      setGroups(next);
    } catch (err) {
      setGroups([]);
      setError(err instanceof Error ? err.message : "Failed to load research");
    } finally {
      setLoading(false);
    }
  }, [scope, workspaceRoot, currentSessionId, enabled, storeSessions]);

  // Clear groups immediately when scope changes to avoid stale flash
  useEffect(() => {
    setGroups([]);
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { groups, loading, error, refresh };
}
