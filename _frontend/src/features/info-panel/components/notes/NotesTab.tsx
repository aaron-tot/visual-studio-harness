import { useEffect, useMemo, useState } from "react";
import { useChatStore } from "../../../../stores/chat";
import { useSessionViewStore } from "../../../../stores/sessionView";
import type { NoteEntry } from "../../../../lib/api";
import type { PlanScope } from "../../types";
import { useNotes } from "../../hooks/useNotes";
import { useNoteMutations } from "../../hooks/useNoteMutations";
import { saveTargetHint } from "../../lib/scope-params";
import { ResultBanner } from "../ui";
import { CreateNoteForm } from "./CreateNoteForm";
import { NoteGroupList } from "./NoteGroupList";
import { NoteEditModal } from "./NoteEditModal";

/** Convert a title to a filesystem-safe slug for the note directory name. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}

interface NotesTabProps {
  active: boolean;
  scope: PlanScope;
}

export function NotesTab({ active, scope }: NotesTabProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [editingNote, setEditingNote] = useState<{
    note: NoteEntry;
    location: Parameters<typeof mutations.update>[1];
  } | null>(null);

  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const chatSessionId = useChatStore((s) => s.sessionId);
  const viewSessionId = useSessionViewStore((s) => s.currentSessionId);
  const currentSessionId = viewSessionId || chatSessionId;

  const { groups, loading, error, refresh } = useNotes({
    scope,
    workspaceRoot,
    currentSessionId,
    enabled: active,
  });

  const mutations = useNoteMutations({
    scope,
    workspaceRoot,
    sessionId: currentSessionId,
    onSuccess: () => void refresh(),
  });

  // Reset expand / edit UI when switching scope tabs
  useEffect(() => {
    setExpandedGroup(null);
    setExpandedNote(null);
    setEditingNote(null);
    mutations.clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on scope change
  }, [scope]);

  /** Existing slug names in the target scope. */
  const existingNames = useMemo(() => {
    const names = new Set<string>();
    if (scope === "global") {
      for (const n of groups[0]?.notes ?? []) names.add(n.name);
      return names;
    }
    const current = groups.find((g) => g.isCurrent);
    for (const n of current?.notes ?? []) names.add(n.name);
    return names;
  }, [groups, scope]);

  const slug = useMemo(() => slugify(createTitle), [createTitle]);
  const nameConflict = !!(slug && existingNames.has(slug));

  const handleCreate = async () => {
    const effectiveTitle = createTitle.trim() || createBody.trim().slice(0, 20);
    const name = slugify(effectiveTitle);
    const ok = await mutations.create(name, effectiveTitle, createBody);
    if (ok) {
      setCreateTitle("");
      setCreateBody("");
      if (scope !== "global") {
        const current = groups.find((g) => g.isCurrent);
        if (current) setExpandedGroup(current.key);
      }
    }
  };

  const handleEditNote = (
    noteName: string,
    note: NoteEntry,
    location: Parameters<typeof mutations.update>[1]
  ) => {
    setEditingNote({ note, location });
  };

  const handleSaveEdit = async (title: string, body: string) => {
    if (!editingNote) return;
    const ok = await mutations.update(
      editingNote.note.name,
      editingNote.location,
      title,
      body
    );
    if (ok) {
      setEditingNote(null);
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
            <CreateNoteForm
              title={createTitle}
              body={createBody}
              busy={mutations.busy}
              onTitleChange={setCreateTitle}
              onBodyChange={setCreateBody}
              onCreate={handleCreate}
            />
          ) : (
            <div className="text-[10px] text-amber-600/90">
              {scope === "project"
                ? "Set a workspace in the chat toolbar to create project notes."
                : "Open or start a session to create session notes."}
            </div>
          )}
          {nameConflict && (
            <div className="text-[10px] text-amber-500">
              A note with the title "{createTitle}" already exists
            </div>
          )}
          <ResultBanner result={mutations.result} />
        </div>

        <NoteGroupList
          flat={scope === "global"}
          groups={groups}
          loading={loading}
          error={error}
          expandedGroup={expandedGroup}
          expandedNote={expandedNote}
          onToggleGroup={(key) =>
            setExpandedGroup((prev) => (prev === key ? null : key))
          }
          onToggleNote={(key) =>
            setExpandedNote((prev) => (prev === key ? null : key))
          }
          busy={mutations.busy}
          onEditNote={handleEditNote}
          onArchive={(name, loc) => void mutations.archive(name, loc)}
          onDelete={(name, loc) => void mutations.remove(name, loc)}
          onMove={(name, loc, toScope) => void mutations.move(name, loc, toScope)}
        />
      </div>

      {editingNote && (
        <NoteEditModal
          note={editingNote.note}
          saving={mutations.busy}
          onSave={handleSaveEdit}
          onClose={() => setEditingNote(null)}
        />
      )}
    </>
  );
}
