import type { SubagentToolSettings, SlotBusyPolicy } from "../../../../_shared/types";
import { useConfigStore } from "../../stores/config";

const SLOT_POLICIES: { id: SlotBusyPolicy; label: string; blurb: string }[] = [
  {
    id: "ask",
    label: "Ask me",
    blurb: "Popup when slots are full: wait, fail, or cancel",
  },
  {
    id: "wait",
    label: "Wait and poll",
    blurb: "Poll until a slot frees or timeout",
  },
  {
    id: "fail",
    label: "Fail immediately",
    blurb: "Return an error to the main agent right away",
  },
];

export function SubagentSettingsCard() {
  const { config, update } = useConfigStore();
  const value: SubagentToolSettings = config.subagent ?? {};

  const patch = async (partial: Partial<SubagentToolSettings>) => {
    const current = useConfigStore.getState().config;
    await update({
      ...current,
      subagent: { ...current.subagent, ...partial },
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">Subagent Tool Settings</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Controls how the task tool spawns subagents. Applies to all agents.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Max concurrent (v1 = 1)</span>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            disabled
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-500"
            value={1}
            readOnly
          />
        </label>

        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-medium text-zinc-300">
              When LLM slots are full
            </h4>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Checked at subagent spawn (llama.cpp <code className="text-zinc-400">/slots</code>).
              Cloud providers without slots are skipped.
            </p>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Policy</span>
            <select
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
              value={value.slotBusyPolicy ?? "ask"}
              onChange={(e) =>
                patch({ slotBusyPolicy: e.target.value as SlotBusyPolicy })
              }
            >
              {SLOT_POLICIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500">
              {
                SLOT_POLICIES.find((p) => p.id === (value.slotBusyPolicy ?? "ask"))
                  ?.blurb
              }
            </p>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs text-zinc-400">Poll interval (sec)</span>
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                value={value.slotPollIntervalSec ?? 5}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n) && n > 0) patch({ slotPollIntervalSec: n });
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-400">Wait timeout (sec, 0=forever)</span>
              <input
                type="number"
                min={0}
                max={3600}
                step={1}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                value={value.slotWaitTimeoutSec ?? 300}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n) && n >= 0) patch({ slotWaitTimeoutSec: n });
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
