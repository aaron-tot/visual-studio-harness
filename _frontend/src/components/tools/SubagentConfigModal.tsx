import { useMemo, useState } from "react";
import type { ThinkingEffort } from "../../../../_shared/types";
import { useConfigStore } from "../../stores/config";
import { useChatStore } from "../../stores/chat";

export interface SubagentConfigPrompt {
  requestId: string;
  sessionId: string;
  toolCallId?: string;
  reason: string;
  suggestedProvider?: string;
  suggestedModel?: string;
}

interface SubagentConfigModalProps {
  prompt: SubagentConfigPrompt;
  onClose: () => void;
}

const EFFORTS: ThinkingEffort[] = ["off", "low", "medium", "high"];

export function SubagentConfigModal({ prompt, onClose }: SubagentConfigModalProps) {
  const config = useConfigStore((s) => s.config);
  const respond = useChatStore((s) => s.respondSubagentConfig);
  const sessionMeta = useChatStore((s) => s.sessionMeta);
  const updateSessionMeta = useChatStore((s) => s.updateSessionMeta);

  const providers = useMemo(
    () => config.providers.filter((p) => p.enabled !== false),
    [config.providers]
  );

  const [providerName, setProviderName] = useState(
    prompt.suggestedProvider ||
      sessionMeta?.providerName ||
      config.defaultProvider ||
      providers[0]?.displayName ||
      ""
  );
  const selectedProvider =
    providers.find((p) => p.displayName === providerName) ?? providers[0];
  const models = (selectedProvider?.models ?? []).filter((m) => m.enabled !== false);

  const [modelName, setModelName] = useState(
    prompt.suggestedModel ||
      sessionMeta?.modelName ||
      config.defaultModel ||
      models[0]?.displayName ||
      ""
  );
  const [temperature, setTemperature] = useState<string>("");
  const [effort, setEffort] = useState<ThinkingEffort>(
    sessionMeta?.thinkingEffort ?? "off"
  );

  const submit = (action: "once" | "global") => {
    if (!providerName.trim() || !modelName.trim()) return;
    const temp =
      temperature.trim() === "" ? undefined : Number(temperature);

    if (action === "global") {
      updateSessionMeta({
        providerName,
        modelName,
        thinkingEffort: effort,
      });
    }

    respond({
      requestId: prompt.requestId,
      sessionId: prompt.sessionId,
      action,
      providerName,
      modelName,
      temperature: temp !== undefined && !Number.isNaN(temp) ? temp : undefined,
      thinkingEffort: effort,
    });
    onClose();
  };

  const cancel = () => {
    respond({
      requestId: prompt.requestId,
      sessionId: prompt.sessionId,
      action: "cancel",
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={cancel}
    >
      <div
        className="w-[420px] max-w-[95vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-medium text-zinc-100">Configure subagent</h2>
        <p className="mt-1 text-xs text-zinc-400">{prompt.reason}</p>

        <div className="mt-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Provider</span>
            <select
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
              value={providerName}
              onChange={(e) => {
                setProviderName(e.target.value);
                const p = providers.find((x) => x.displayName === e.target.value);
                const first = p?.models.find((m) => m.enabled !== false);
                if (first) setModelName(first.displayName);
              }}
            >
              {providers.map((p) => (
                <option key={p.displayName} value={p.displayName}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-400">Model</span>
            <select
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.displayName} value={m.displayName}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs text-zinc-400">Temperature</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-zinc-400">Thinking</span>
              <select
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                value={effort}
                onChange={(e) => setEffort(e.target.value as ThinkingEffort)}
              >
                {EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-600"
            onClick={() => submit("once")}
            disabled={!providerName || !modelName}
          >
            Use for this task only
          </button>
          <button
            type="button"
            className="rounded-md bg-blue-800 px-3 py-2 text-sm text-white hover:bg-blue-700"
            onClick={() => submit("global")}
            disabled={!providerName || !modelName}
          >
            Save as global subagent default
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={cancel}
          >
            Cancel task
          </button>
        </div>
      </div>
    </div>
  );
}
