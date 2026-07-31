import { useConfigStore } from "../../stores/config";
import type { ConfigFile } from "../../../../_shared/types/config";
import type { KnowledgeBaseConfig } from "../../../../_shared/types/config";
import { ModelDropdown } from "../chat/ModelDropdown";

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
      <div>
        <div className="text-sm text-zinc-200">{title}</div>
        {desc && <div className="text-xs text-zinc-500 mt-0.5">{desc}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-48">
        <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.max(min, max ? Math.min(max, Number(e.target.value)) : Number(e.target.value)))}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 text-center"
        />
      </div>
      {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
    </div>
  );
}

export function KnowledgeSettingsPanel() {
  const { config, update } = useConfigStore();

  const kb = config.knowledge ?? {
    enabled: true,
    sourcesPath: "knowledge/sources",
    dbPath: "knowledge/knowledge.db",
    embedding: { providerId: "Jina AI", model: "jina-embeddings-v3", batchSize: 50 },
    search: { vectorWeight: 0.6, keywordWeight: 0.3, metadataWeight: 0.1, topK: 10, reranking: false },
  };

  const providers = config.providers || [];
  const providerOptions = providers
    .filter((p) => p.models?.some((m) => m.enabled !== false))
    .map((p) => ({ value: p.displayName, label: p.displayName }));

  const patch = (partial: Partial<KnowledgeBaseConfig>) => {
    const current = useConfigStore.getState().config;
    const newKb = { ...kb, ...partial };
    update({ ...current, knowledge: newKb });
  };

  const patchSearch = (partial: Partial<KnowledgeBaseConfig["search"]>) => {
    patch({ search: { ...kb.search, ...partial } });
  };

  const patchEmbedding = (partial: Partial<KnowledgeBaseConfig["embedding"]>) => {
    patch({ embedding: { ...kb.embedding, ...partial } });
  };

  return (
    <div className="space-y-4">
      <Section title="Knowledge Base" desc="Enable and configure the local knowledge base system">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={kb.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
          />
          <div>
            <div className="text-sm text-zinc-200">Enabled</div>
            <div className="text-xs text-zinc-500">Index documents from sources folder and enable search</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Sources Path</div>
            <input
              type="text"
              value={kb.sourcesPath}
              onChange={(e) => patch({ sourcesPath: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
            />
            <div className="text-[10px] text-zinc-500 mt-0.5">Relative to scope data directory</div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Database Path</div>
            <input
              type="text"
              value={kb.dbPath}
              onChange={(e) => patch({ dbPath: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
            />
            <div className="text-[10px] text-zinc-500 mt-0.5">Relative to scope data directory</div>
          </div>
        </div>
      </Section>

      <Section title="Embedding Provider" desc="Configure the embedding model for semantic search">
        <div>
          <div className="text-[11px] text-zinc-500 mb-1">Embedding Model</div>
          <ModelDropdown
            providerName={kb.embedding.providerId}
            modelName={kb.embedding.model}
            onSelect={(provider, model) => patchEmbedding({ providerId: provider, model })}
          />
        </div>
        <NumberField
          label="Batch Size"
          value={kb.embedding.batchSize}
          onChange={(v) => patchEmbedding({ batchSize: v })}
          min={1}
          max={100}
        />
        <div className="text-xs text-zinc-500 mt-1">
          Available providers: {config.providers.filter(p => p.models?.some(m => m.enabled !== false)).map(p => p.displayName).join(", ") || "None configured"}
        </div>
      </Section>

      <Section title="Search Weights" desc="Hybrid search combines vector (semantic) and keyword (exact) scores">
        <div className="space-y-3">
          <NumberField
            label="Vector Weight"
            value={kb.search.vectorWeight}
            onChange={(v) => patchSearch({ vectorWeight: v })}
            min={0}
            max={1}
            step={0.1}
          />
          <NumberField
            label="Keyword Weight"
            value={kb.search.keywordWeight}
            onChange={(v) => patchSearch({ keywordWeight: v })}
            min={0}
            max={1}
            step={0.1}
          />
          <NumberField
            label="Metadata Weight"
            value={kb.search.metadataWeight}
            onChange={(v) => patchSearch({ metadataWeight: v })}
            min={0}
            max={1}
            step={0.1}
          />
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          Weights are normalized. Vector + Keyword + Metadata = 1.0 (approximately)
        </div>
      </Section>

      <Section title="Search Limits" desc="Control search result limits and behavior">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField
            label="Top K Results"
            value={kb.search.topK}
            onChange={(v) => patchSearch({ topK: v })}
            min={1}
            max={100}
          />
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Reranking</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={kb.search.reranking}
                onChange={(e) => patchSearch({ reranking: e.target.checked })}
                className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-sm text-zinc-200">Enable reranking (requires embedding provider)</span>
            </label>
          </div>
        </div>
      </Section>

      <Section title="Current Configuration" desc="Live view of the knowledge base config">
        <pre className="bg-zinc-900/50 border border-zinc-800 rounded p-3 text-[10px] text-zinc-400 overflow-auto">
          {JSON.stringify(kb, null, 2)}
        </pre>
      </Section>
    </div>
  );
}
