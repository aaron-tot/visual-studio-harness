import { useCallback, useEffect, useState } from "react";
import { listPlans, listPlansBatched, listSessions, listWorkspaces } from "../../../lib/api";
import type { DesignGroup, PlanScope } from "../types";
import { workspaceLabel } from "../types";

interface UsePlansOptions {
  scope: PlanScope;
  /** Current open workspace (chat store) — create target for project scope */
  workspaceRoot: string | null | undefined;
  /** Current session — create target for session scope */
  currentSessionId: string | null | undefined;
  /** Only fetch when true (e.g. panel open) */
  enabled?: boolean;
}

/**
 * Global: flat list of designs under dataDir/designs.
 * Project: groups by workspace; current workspace first; only workspaces with
 *          designs (current always included even if empty).
 * Session: groups by session; current first; only sessions with designs
 *          (current always included).
 */
export function usePlans({
  scope,
  workspaceRoot,
  currentSessionId,
  enabled = true,
}: UsePlansOptions) {
  const [groups, setGroups] = useState<DesignGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    setGroups([]);
    try {
      if (scope === "global") {
        const designs = await listPlans({ scope: "global" });
        setGroups([
          {
            key: "global",
            label: "Global",
            isCurrent: true,
            designs,
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

        const batchResult = await listPlansBatched({
          scope: "project",
          workspaceRoots: [...roots],
        });

        const loaded = [...roots].map((root) => ({
          key: `project:${root}`,
          label: workspaceLabel(root),
          isCurrent: !!current && root === current,
          designs: batchResult[root] || [],
          location: { scope: "project" as const, workspaceRoot: root },
        }));

        // Current first (even if empty); others only if they have ideas.
        const currentGroup = loaded.find((g) => g.isCurrent);
        const others = loaded
          .filter((g) => !g.isCurrent && g.designs.length > 0)
          .sort((a, b) => a.label.localeCompare(b.label));

        const next: DesignGroup[] = [];
        if (currentGroup) {
          next.push({
            key: currentGroup.key,
            label: currentGroup.label,
            isCurrent: true,
            designs: currentGroup.designs,
            location: currentGroup.location,
          });
        }
        for (const g of others) {
          next.push({
            key: g.key,
            label: g.label,
            isCurrent: false,
            designs: g.designs,
            location: g.location,
          });
        }
        setGroups(next);
        return;
      }

      // session scope
      const sessionList = await listSessions();
      const byId = new Map(sessionList.map((s) => [s.id, s]));
      const ids = new Set<string>();
      if (currentSessionId) ids.add(currentSessionId);
      for (const s of sessionList) ids.add(s.id);

      const batchResult = await listPlansBatched({
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
          designs: batchResult[sid] || [],
          location: { scope: "session" as const, sessionId: sid },
        };
      });

      const currentGroup = loaded.find((g) => g.isCurrent);
      const others = loaded
        .filter((g) => !g.isCurrent && g.designs.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label));

      const next: DesignGroup[] = [];
      if (currentGroup) {
        next.push({
          key: currentGroup.key,
          label: currentGroup.label,
          isCurrent: true,
          designs: currentGroup.designs,
          location: currentGroup.location,
        });
      }
      for (const g of others) {
        next.push({
          key: g.key,
          label: g.label,
          isCurrent: false,
          designs: g.designs,
          location: g.location,
        });
      }
      setGroups(next);
    } catch (err) {
      setGroups([]);
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, [scope, workspaceRoot, currentSessionId, enabled]);

  // Clear groups immediately when scope changes to avoid stale flash
  useEffect(() => {
    setGroups([]);
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { groups, loading, error, refresh };
}
