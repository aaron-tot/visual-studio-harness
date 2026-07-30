import { useEffect, useMemo, useState } from "react";
import { useChatStore } from "../../../../stores/chat";
import { useSessionViewStore } from "../../../../stores/sessionView";
import type { ResearchDoc, ResearchEntry } from "../../../../lib/api";
import type { PlanScope } from "../../types";
import { useResearchDocs } from "../../hooks/useResearchDocs";
import { useResearchMutations } from "../../hooks/useResearchMutations";
import { saveTargetHint } from "../../lib/scope-params";
import { ResultBanner } from "../ui";
import { CreateResearchForm } from "./CreateResearchForm";
import { ResearchGroupList } from "./ResearchGroupList";
import { ResearchEditor } from "./ResearchEditor";

interface ResearchTabProps {
  active: boolean;
  scope: PlanScope;
}

export function ResearchTab({ active, scope }: ResearchTabProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createGoal, setCreateGoal] = useState("");
  const [editingDoc, setEditingDoc] = useState<{
    entry: ResearchEntry;
    location: Parameters<typeof mutations.update>[1];
  } | null>(null);

  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const chatSessionId = useChatStore((s) => s.sessionId);
  const viewSessionId = useSessionViewStore((s) => s.currentSessionId);
  const currentSessionId = viewSessionId || chatSessionId;

  const { groups, loading, error, refresh } = useResearchDocs({
    scope,
    workspaceRoot,
    currentSessionId,
    enabled: active,
  });

  const mutations = useResearchMutations({
    scope,
    workspaceRoot,
    sessionId: currentSessionId,
    onSuccess: () => void refresh(),
  });

  // Reset expand / edit UI when switching scope tabs
  useEffect(() => {
    setExpandedGroup(null);
    setExpandedDoc(null);
    setEditingDoc(null);
    mutations.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on scope change
  }, [scope]);

  /** Existing doc names in the target scope. */
  const existingNames = useMemo(() => {
    const names = new Set<string>();
    if (scope === "global") {
      for (const d of groups[0]?.docs ?? []) names.add(d.name);
      return names;
    }
    const current = groups.find((g) => g.isCurrent);
    for (const d of current?.docs ?? []) names.add(d.name);
    return names;
  }, [groups, scope]);

  const slug = useMemo(() => slugify(createTitle), [createTitle]);
  const nameConflict = !!(slug && existingNames.has(slug));

  const handleCreate = async () => {
    const name = slugify(createTitle);
    const now = new Date().toISOString();
    const doc: ResearchDoc = {
      meta: {
        id: name,
        title: createTitle.trim(),
        createdAt: now,
        updatedAt: now,
      },
      goal: createGoal.trim(),
      initialQueryPoints: [],
      discoveredQueryPoints: [],
    };
    const ok = await mutations.create(name, doc);
    if (ok) {
      setCreateTitle("");
      setCreateGoal("");
      if (scope !== "global") {
        const current = groups.find((g) => g.isCurrent);
        if (current) setExpandedGroup(current.key);
      }
    }
  };

  const handleEditDoc = (name: string, entry: ResearchEntry, location: Parameters<typeof mutations.update>[1]) => {
    setEditingDoc({ entry, location });
  };

  const handleSaveEdit = async (doc: ResearchDoc) => {
    if (!editingDoc) return;
    const ok = await mutations.update(editingDoc.entry.name, editingDoc.location, doc);
    if (ok) {
      setEditingDoc(null);
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
          {targetHint && (
            <div className="text-[9px] text-zinc-600 leading-snug">{targetHint}</div>
          )}
          {canCreate ? (
            <CreateResearchForm
              title={createTitle}
              goal={createGoal}
              busy={mutations.busy}
              onTitleChange={setCreateTitle}
              onGoalChange={setCreateGoal}
              onCreate={handleCreate}
            />
          ) : (
            <div className="text-[10px] text-amber-600/90">
              {scope === "project"
                ? "Set a workspace in the chat toolbar to create project research."
                : "Open or start a session to create session research."}
            </div>
          )}
          {nameConflict && (
            <div className="text-[10px] text-amber-500">
              A research doc with the title "{createTitle}" already exists
            </div>
          )}
          <ResultBanner result={mutations.result} />
        </div>

        <ResearchGroupList
          flat={scope === "global"}
          groups={groups}
          loading={loading}
          error={error}
          expandedGroup={expandedGroup}
          expandedDoc={expandedDoc}
          onToggleGroup={(key) =>
            setExpandedGroup((prev) => (prev === key ? null : key))
          }
          onToggleDoc={(key) =>
            setExpandedDoc((prev) => (prev === key ? null : key))
          }
          busy={mutations.busy}
          onEditDoc={handleEditDoc}
          onDeleteDoc={(name, loc) => void mutations.remove(name, loc)}
        />
      </div>

      {editingDoc && (
        <ResearchEditor
          doc={editingDoc.entry.document}
          saving={mutations.busy}
          onSave={handleSaveEdit}
          onClose={() => setEditingDoc(null)}
        />
      )}
    </>
  );
}

/** Convert a title to a filesystem-safe slug for the doc directory name. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}
