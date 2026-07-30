import { PanelButton, PanelInput } from "../ui";

interface CreateNoteFormProps {
  title: string;
  body: string;
  busy: boolean;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCreate: () => void;
}

export function CreateNoteForm({
  title,
  body,
  busy,
  onTitleChange,
  onBodyChange,
  onCreate,
}: CreateNoteFormProps) {
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <PanelInput
        placeholder="Note title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
      />
      <textarea
        className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1.5 rounded outline-none placeholder-zinc-600 resize-none"
        placeholder="Note body…"
        rows={3}
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
      />
      <PanelButton
        className="w-full py-1.5"
        disabled={busy || !title.trim()}
        onClick={onCreate}
      >
        + Create Note
      </PanelButton>
    </div>
  );
}
