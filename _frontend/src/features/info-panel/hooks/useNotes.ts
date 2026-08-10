import { useCallback, useEffect, useState } from "react";
import { listNotes, listSessions, listWorkspaces } from "../../../lib/api";
import type { NoteGroup, PlanScope } from "../types";
import { workspaceLabel } from "../types";

interface UseNotesOptions {
  scope: PlanScope;
  workspaceRoot: string | null | undefined;
  currentSessionId: string | null | undefined;
  enabled?: boolean;
}

export function useNotes({
  scope,
  workspaceRoot,
  currentSessionId,
  enabled = true,
}: UseNotesOptions) {
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    setGroups([]);
    try {
      if (scope === "global") {
        const notes = await listNotes({ scope: "global" });
        setGroups([
          {
            key: "global",
            label: "Global",
            isCurrent: true,
            notes,
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

        const loaded = await Promise.all(
          [...roots].map(async (root) => {
            const notes = await listNotes({ scope: "project", workspaceRoot: root });
            return {
              key: `project:${root}`,
              label: workspaceLabel(root),
              isCurrent: !!current && root === current,
              notes,
              location: { scope: "project" as const, workspaceRoot: root },
            };
          })
        );

        const currentGroup = loaded.find((g) => g.isCurrent);
        const others = loaded
          .filter((g) => !g.isCurrent && g.notes.length > 0)
          .sort((a, b) => a.label.localeCompare(b.label));

        const next: NoteGroup[] = [];
        if (currentGroup) next.push(currentGroup);
        for (const g of others) next.push(g);
        setGroups(next);
        return;
      }

      // session scope
      const sessionList = await listSessions();
      const byId = new Map(sessionList.map((s) => [s.id, s]));
      const ids = new Set<string>();
      if (currentSessionId) ids.add(currentSessionId);
      for (const s of sessionList) ids.add(s.id);

      const loaded = await Promise.all(
        [...ids].map(async (sid) => {
          const notes = await listNotes({ scope: "session", sessionId: sid });
          const meta = byId.get(sid);
          const title = meta?.title?.trim() || sid;
          return {
            key: `session:${sid}`,
            label: title,
            isCurrent: sid === currentSessionId,
            notes,
            location: { scope: "session" as const, sessionId: sid },
          };
        })
      );

      const currentGroup = loaded.find((g) => g.isCurrent);
      const others = loaded
        .filter((g) => !g.isCurrent && g.notes.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label));

      const next: NoteGroup[] = [];
      if (currentGroup) next.push(currentGroup);
      for (const g of others) next.push(g);
      setGroups(next);
    } catch (err) {
      setGroups([]);
      setError(err instanceof Error ? err.message : "Failed to load notes");
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
