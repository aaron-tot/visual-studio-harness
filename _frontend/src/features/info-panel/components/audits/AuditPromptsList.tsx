import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clipboard, Copy, SendHorizontal, Loader2 } from "lucide-react";
import { listAuditPrompts } from "../../../../lib/api";
import type { AuditPrompt, AuditPromptCategory } from "../../../../../../_shared/types/audit";

export function AuditPromptsList() {
  const [expanded, setExpanded] = useState(false);
  const [prompts, setPrompts] = useState<AuditPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    setError(null);
    listAuditPrompts()
      .then((r) => setPrompts(r.prompts.map((e) => e.prompt)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed to load"))
      .finally(() => setLoading(false));
  }, [expanded]);

  const general = prompts.filter((p) => p.category === "general");
  const impl = prompts.filter((p) => p.category === "implementation");

  const handleCopy = (prompt: AuditPrompt, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.templateInstructions).catch(() => {});
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleInject = (prompt: AuditPrompt, e: React.MouseEvent) => {
    e.stopPropagation();
    document.dispatchEvent(
      new CustomEvent("VISUAL STUDIO HARNESS:stage-input", {
        detail: { content: prompt.templateInstructions, position: "end" },
      })
    );
  };

  return (
    <div className="pt-2 pb-3 px-3">
      <div
        className="flex items-center gap-1 px-1 py-1.5 hover:bg-zinc-900 transition-colors cursor-pointer rounded"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-zinc-600" />
        )}
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Audit Prompts
        </span>
        <span className="text-[9px] text-zinc-700">({prompts.length || "…"})</span>
      </div>

      {expanded && (
        <div className="mt-1 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={14} className="animate-spin text-zinc-600" />
            </div>
          )}

          {error && (
            <div className="text-[9px] text-red-500 px-2 py-1 rounded bg-red-900/20">{error}</div>
          )}

          {!loading && !error && prompts.length === 0 && (
            <div className="text-[9px] text-zinc-600 px-2 py-3 text-center">
              No audit prompts loaded. Create one with the agent.
            </div>
          )}

          {!loading && !error && general.length > 0 && (
            <PromptSection
              label="General Audits"
              prompts={general}
              copiedId={copiedId}
              onCopy={handleCopy}
              onInject={handleInject}
            />
          )}

          {!loading && !error && impl.length > 0 && (
            <PromptSection
              label="Implementation Audits"
              prompts={impl}
              copiedId={copiedId}
              onCopy={handleCopy}
              onInject={handleInject}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────

function PromptSection({
  label,
  prompts,
  copiedId,
  onCopy,
  onInject,
}: {
  label: string;
  prompts: AuditPrompt[];
  copiedId: string | null;
  onCopy: (p: AuditPrompt, e: React.MouseEvent) => void;
  onInject: (p: AuditPrompt, e: React.MouseEvent) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-zinc-900/50 rounded transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? (
          <ChevronRight size={10} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronDown size={10} className="shrink-0 text-zinc-600" />
        )}
        <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
        <span className="text-[8px] text-zinc-700">({prompts.length})</span>
      </div>

      {!collapsed && (
        <div className="space-y-1 mt-1">
          {prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="group relative px-2 py-1.5 rounded bg-zinc-900/50 hover:bg-zinc-900 transition-colors border border-zinc-800"
            >
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-zinc-300 font-medium truncate">
                    {prompt.name}
                  </div>
                  <div className="text-[8px] text-zinc-600 uppercase tracking-wider mt-px">
                    {prompt.auditType}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    className="text-[9px] px-1.5 py-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    onClick={(e) => onCopy(prompt, e)}
                    title="Copy prompt text"
                  >
                    {copiedId === prompt.id ? (
                      <Clipboard size={11} className="text-emerald-500" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="text-[9px] px-1.5 py-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    onClick={(e) => onInject(prompt, e)}
                    title="Inject into chat input"
                  >
                    <SendHorizontal size={11} />
                  </button>
                </div>
              </div>
              {prompt.description && (
                <div className="text-[9px] text-zinc-600 leading-snug mt-1 line-clamp-2">
                  {prompt.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
