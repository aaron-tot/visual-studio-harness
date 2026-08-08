import { useEffect, useState } from "react";
import { X, Save, FileCode2, FileText, Loader2 } from "lucide-react";
import type { ToolConfig } from "../../lib/api";
import {
  getToolConfig,
  putToolConfig,
  getToolEntry,
  putToolEntry,
  getToolSkill,
  putToolSkill,
} from "../../lib/api";

interface Props {
  name: string;
  onClose: () => void;
  onSaved?: () => void;
}

type DirtyState = "loading" | "clean" | "dirty" | "saving" | "error";

export function ToolConfigEditor({ name, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<"builtin" | "custom">("builtin");
  const [config, setConfig] = useState<ToolConfig | null>(null);
  const [entryFile, setEntryFile] = useState("");
  const [skill, setSkill] = useState("");
  const [dirty, setDirty] = useState<DirtyState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDirty("loading");
    setError(null);
    (async () => {
      try {
        const [cfg, ent, sk] = await Promise.all([
          getToolConfig(name),
          getToolEntry(name),
          getToolSkill(name),
        ]);
        if (cancelled) return;
        setKind(cfg.kind);
        setConfig(cfg.config);
        setEntryFile(ent.code);
        setSkill(sk.skill);
        setDirty("clean");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setDirty("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  const patch = (partial: Partial<ToolConfig>) => {
    setConfig((c) => (c ? { ...c, ...partial } : c));
    setDirty((d) => (d === "clean" ? "dirty" : d));
  };

  const patchTimeouts = (partial: Record<string, number | undefined>) => {
    setConfig((c) => (c ? { ...c, timeouts: { ...(c.timeouts ?? {}), ...partial } } : c));
    setDirty((d) => (d === "clean" ? "dirty" : d));
  };

  const patchSkill = (partial: Partial<NonNullable<ToolConfig["skill"]>>) => {
    setConfig((c) =>
      c
        ? {
            ...c,
            skill: {
              ...(c.skill ?? {}),
              guide: c.skill?.guide ?? "",
              pushMode: c.skill?.pushMode ?? "soft",
              ...partial,
            },
          }
        : c
    );
    setDirty((d) => (d === "clean" ? "dirty" : d));
  };

  const markEntryDirty = () => setDirty((d) => (d === "clean" ? "dirty" : d));
  const markSkillDirty = () => setDirty((d) => (d === "clean" ? "dirty" : d));

  const handleSave = async () => {
    if (!config) return;
    setDirty("saving");
    setError(null);
    try {
      await putToolConfig(name, config);
      await putToolEntry(name, entryFile);
      await putToolSkill(name, skill);
      setDirty("clean");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDirty("dirty");
    }
  };

  const inputCls =
    "w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100";
  const areaCls =
    "w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-100";

  if (dirty === "loading") {
    return (
      <ModalShell title={`Loading: ${name}`} onClose={onClose}>
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tool folder...
        </p>
      </ModalShell>
    );
  }

  if (dirty === "error" || !config) {
    return (
      <ModalShell title={`Edit tool: ${name}`} onClose={onClose}>
        <p className="text-xs text-red-400">{error ?? "Failed to load tool config."}</p>
      </ModalShell>
    );
  }

  const t = config.timeouts;

  return (
    <ModalShell title={`Edit tool: ${name}`} onClose={onClose} footer={
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={dirty === "saving" || dirty === "clean"}
        className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {dirty === "saving" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {dirty === "clean" ? "Saved" : "Save"}
      </button>
    }>
      {error && <p className="mb-3 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400">{error}</p>}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{kind}</span>
          <span className="text-[10px] text-zinc-600">entry: {config.entry}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Description</label>
            <input
              type="text"
              value={config.description}
              onChange={(e) => patch({ description: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Permission default</label>
            <select
              value={config.permissionDefault}
              onChange={(e) => patch({ permissionDefault: e.target.value as ToolConfig["permissionDefault"] })}
              className={inputCls}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
            />
            Enabled
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={config.externalAccess === true}
              onChange={(e) => patch({ externalAccess: e.target.checked })}
              className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
            />
            External access
          </label>
        </div>

        {(t?.minMs !== undefined || t?.maxMs !== undefined || t?.defaultMs !== undefined) && (
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Timeouts (ms)</label>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="minMs" value={t?.minMs} onChange={(n) => patchTimeouts({ minMs: n })} />
              <NumberField label="defaultMs" value={t?.defaultMs} onChange={(n) => patchTimeouts({ defaultMs: n })} />
              <NumberField label="maxMs" value={t?.maxMs} onChange={(n) => patchTimeouts({ maxMs: n })} />
            </div>
          </div>
        )}
        {(t?.minSec !== undefined || t?.maxSec !== undefined || t?.defaultSec !== undefined) && (
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Timeouts (sec)</label>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="minSec" value={t?.minSec} onChange={(n) => patchTimeouts({ minSec: n })} />
              <NumberField label="defaultSec" value={t?.defaultSec} onChange={(n) => patchTimeouts({ defaultSec: n })} />
              <NumberField label="maxSec" value={t?.maxSec} onChange={(n) => patchTimeouts({ maxSec: n })} />
            </div>
          </div>
        )}

        {config.skill && (
          <div className="rounded border border-zinc-800 p-2">
            <div className="mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-zinc-400" />
              <label className="text-xs text-zinc-400">Skill push mode</label>
              <select
                value={config.skill.pushMode}
                onChange={(e) => patchSkill({ pushMode: e.target.value as "soft" | "hard" | "custom" })}
                className="ml-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
              >
                <option value="soft">soft</option>
                <option value="hard">hard</option>
                <option value="custom">custom</option>
              </select>
            </div>
            {config.skill.pushMode === "custom" && (
              <div className="mb-2">
                <label className="mb-1 block text-xs text-zinc-400">Custom push text</label>
                <textarea
                  value={config.skill.customPushText ?? ""}
                  onChange={(e) => patchSkill({ customPushText: e.target.value })}
                  className={areaCls}
                  rows={2}
                />
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <FileCode2 className="h-3.5 w-3.5 text-zinc-400" />
            <label className="text-xs text-zinc-400">Entry ({config.entry})</label>
          </div>
          <textarea
            value={entryFile}
            onChange={(e) => { setEntryFile(e.target.value); markEntryDirty(); }}
            className={areaCls}
            rows={10}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-zinc-400" />
            <label className="text-xs text-zinc-400">skill.md</label>
          </div>
          <textarea
            value={skill}
            onChange={(e) => { setSkill(e.target.value); markSkillDirty(); }}
            className={areaCls}
            rows={8}
            placeholder="# <tool> skill guide (markdown)"
          />
        </div>
      </div>
    </ModalShell>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-zinc-500">{label}</label>
      <input
        type="number"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") { onChange(undefined); return; }
          const n = parseInt(raw, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
      />
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-[720px] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
