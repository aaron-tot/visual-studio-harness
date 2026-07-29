import { useConfigStore } from "../../stores/config";
import type { BashToolSettings } from "../../../../_shared/types";

export function BashToolSettingsCard() {
  const { config, update } = useConfigStore();
  const value: BashToolSettings = config.toolSettings?.bash ?? {};

  const patch = async (partial: Partial<BashToolSettings>) => {
    const current = useConfigStore.getState().config;
    await update({
      ...current,
      toolSettings: {
        ...current.toolSettings,
        bash: { ...current.toolSettings?.bash, ...partial },
      },
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">Bash Tool Settings</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          Timeout bounds for the bash tool. The agent can pick any timeout within these limits.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Default timeout (ms)</span>
          <input
            type="number"
            min={100}
            max={3_600_000}
            step={1000}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.timeoutDefaultMs ?? 30_000}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n >= 100) patch({ timeoutDefaultMs: n });
            }}
          />
          <p className="text-[11px] text-zinc-500">
            Used when the agent does not specify <code className="text-zinc-400">timeout_ms</code>
          </p>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Minimum timeout (ms)</span>
          <input
            type="number"
            min={100}
            max={3_600_000}
            step={1000}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.timeoutMinMs ?? 100}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n >= 100) patch({ timeoutMinMs: n });
            }}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-zinc-400">Maximum timeout (ms)</span>
          <input
            type="number"
            min={100}
            max={3_600_000}
            step={1000}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
            value={value.timeoutMaxMs ?? 300_000}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n) && n >= 100) patch({ timeoutMaxMs: n });
            }}
          />
          <p className="text-[11px] text-zinc-500">
            Hard cap — the agent's <code className="text-zinc-400">timeout_ms</code> is clamped to this value
          </p>
        </label>
      </div>
    </div>
  );
}
