import { useConfigStore } from "../../stores/config";
import type { ConfigFile } from "../../../../_shared/types";

export function TestModelsPanel() {
  const { config, update } = useConfigStore();
  const models = config.testModels ?? {};

  const modelLabels: Record<string, string> = {
    model1000: "model1000 — counts 1 to 1000",
    "model-mixed": "model-mixed — counting, tool call, thinking",
    "model-alltools": "model-alltools — all tools with text",
    toolsV2: "toolsV2 — basic tool call",
    test: "test — basic text response",
  };

  const handleChange = (modelName: string, tokensPerSecond: number) => {
    const nextModels: ConfigFile["testModels"] = { ...models, [modelName]: { ...models[modelName], tokensPerSecond } };
    update({ ...config, testModels: nextModels });
  };

  const sliderValue = (tps = 250) => {
    // Map 0-1000 t/s to slider 0-100 so it's usable
    if (tps <= 0) return 0;
    if (tps >= 1000) return 100;
    return Math.round(tps / 10);
  };

  const fromSlider = (val: number) => val * 10;

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-medium text-zinc-300">Test Model Speed</h3>
      <p className="text-xs text-zinc-500">
        Tokens per second. Higher = faster stream. 250 t/s = ~4s for 1000 numbers.
      </p>

      {Object.entries(modelLabels).map(([key, label]) => {
        const tps = models[key]?.tokensPerSecond ?? 250;
        return (
          <div key={key} className="border border-zinc-800 rounded-lg p-3 space-y-2">
            <label className="text-sm text-zinc-300">{label}</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sliderValue(tps)}
                onChange={(e) => handleChange(key, fromSlider(Number(e.target.value)))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-xs text-zinc-400 w-24 text-right font-mono">
                {tps === 0 ? "instant" : `${tps} t/s`}
              </span>
              <input
                type="number"
                min={0}
                max={10000}
                step={10}
                value={tps}
                onChange={(e) => handleChange(key, Math.max(0, Number(e.target.value)))}
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 text-right font-mono"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
