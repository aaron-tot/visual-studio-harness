import { PanelButton, PanelInput } from "../ui";
import type { DocMode } from "../../types";

interface CreateIdeaFormProps {
  createName: string;
  endGoal: string;
  nameConflict: boolean;
  busy: boolean;
  onNameChange: (v: string) => void;
  onEndGoalChange: (v: string) => void;
  onCreate: (mode: DocMode) => void;
}

export function CreateIdeaForm({
  createName,
  endGoal,
  nameConflict,
  busy,
  onNameChange,
  onEndGoalChange,
  onCreate,
}: CreateIdeaFormProps) {
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <PanelInput
        placeholder="Idea name"
        value={createName}
        onChange={(e) => onNameChange(e.target.value)}
      />
      {createName.trim() && (
        <>
          {nameConflict && (
            <div className="text-[10px] text-amber-500">Idea name already exists</div>
          )}
          <PanelInput
            placeholder="End goal (optional for now)"
            value={endGoal}
            onChange={(e) => onEndGoalChange(e.target.value)}
          />
          <div className="flex gap-1">
            <PanelButton
              className="flex-1 py-1.5"
              disabled={busy || !!nameConflict}
              onClick={() => onCreate("spec")}
            >
              + Create Spec
            </PanelButton>
            <PanelButton
              className="flex-1 py-1.5"
              disabled={busy || !!nameConflict}
              onClick={() => onCreate("plan")}
            >
              + Create Plan
            </PanelButton>
          </div>
        </>
      )}
    </div>
  );
}
