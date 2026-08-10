import { useState } from "react";
import { Settings2 } from "lucide-react";
import { useConfigStore } from "../../stores/config";

interface ModelRoutingEditorProps {
  providerIndex: number;
  modelIndex: number;
  onClose: () => void;
}

/**
 * Inline per-model OpenRouter-style routing editor: comma-separated provider
 * order + allow-fallbacks toggle. Writes back into the model's config.
 */
export function ModelRoutingEditor({ providerIndex, modelIndex, onClose }: ModelRoutingEditorProps) {
  const { update } = useConfigStore();
  const model = useConfigStore((s) => s.config.providers[providerIndex]?.models[modelIndex]);
  const [order, setOrder] = useState((model?.providerOrder ?? []).join(", "));
  const [allow, setAllow] = useState(model?.allowProviderFallbacks ?? true);

  if (!model) return null;

  const save = () => {
    const parsed = order.split(",").map((s) => s.trim()).filter(Boolean);
    const current = useConfigStore.getState().config;
    const providers = [...current.providers];
    providers[providerIndex] = {
      ...providers[providerIndex],
      models: providers[providerIndex].models.map((m, i) =>
        i === modelIndex
          ? { ...m, providerOrder: parsed.length ? parsed : undefined, allowProviderFallbacks: allow }
          : m
      ),
    };
    update({ ...current, providers });
    onClose();
  };

  return (
    <div className="mt-1 p-2 bg-zinc-900 border border-zinc-700 rounded space-y-2">
      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          Provider order (comma-separated)
        </label>
        <input
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          placeholder="deepinfra, together"
          className="w-full rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm"
        />
        <p className="text-[10px] text-zinc-500 mt-1">
          Empty = leave provider default routing.
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={allow}
          onChange={(e) => setAllow(e.target.checked)}
          className="accent-zinc-400"
        />
        Allow provider fallbacks
      </label>
      <div className="flex gap-2 pt-1">
        <button
          onClick={save}
          className="px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-xs"
        >
          Save
        </button>
        <button
          onClick={onClose}
          className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Small gear toggle that opens the routing editor for a model row. */
export function RoutingButton({
  open,
  onToggle,
  title = "Provider routing (OpenRouter order / fallbacks)",
}: {
  open: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`p-1 rounded ${open ? "bg-zinc-600" : "hover:bg-zinc-600"}`}
      title={title}
    >
      <Settings2 size={14} />
    </button>
  );
}
