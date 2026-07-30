import { PanelButton, PanelInput } from "../ui";

interface CreateResearchFormProps {
  title: string;
  goal: string;
  busy: boolean;
  onTitleChange: (v: string) => void;
  onGoalChange: (v: string) => void;
  onCreate: () => void;
}

export function CreateResearchForm({
  title,
  goal,
  busy,
  onTitleChange,
  onGoalChange,
  onCreate,
}: CreateResearchFormProps) {
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <PanelInput
        placeholder="Research title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
      />
      <textarea
        className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1.5 rounded outline-none placeholder-zinc-600 resize-none"
        placeholder="Research goal / question to investigate…"
        rows={3}
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
      />
      <PanelButton
        className="w-full py-1.5"
        disabled={busy || !title.trim()}
        onClick={onCreate}
      >
        + Create Research
      </PanelButton>
    </div>
  );
}
