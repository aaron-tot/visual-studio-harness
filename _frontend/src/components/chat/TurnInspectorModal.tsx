import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TurnDetail, StepSummary } from "../../../_shared/types/trace";
import { getTurn, getTurnRaw } from "../../lib/api";

interface TurnInspectorModalProps {
  sessionId: string;
  turnNumber: number;
  onClose: () => void;
}

function JsonValue({ value, indent = 0 }: { value: unknown; indent?: number }) {
  if (value === null) return <span className="text-zinc-500">null</span>;
  if (value === undefined) return <span className="text-zinc-500">undefined</span>;
  if (typeof value === "string") return <span className="text-emerald-400">"{value}"</span>;
  if (typeof value === "number") return <span className="text-amber-400">{value}</span>;
  if (typeof value === "boolean") return <span className="text-purple-400">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    return (
      <span>
        <span className="text-zinc-400">[</span>
        {"\n"}
        {value.map((item, i) => (
          <span key={i}>
            {pad}
            <JsonValue value={item} indent={indent + 1} />
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closePad}
        <span className="text-zinc-400">]</span>
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-zinc-500">{"{}"}</span>;
    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    return (
      <span>
        <span className="text-zinc-400">{"{"}</span>
        {"\n"}
        {entries.map(([key, val], i) => (
          <span key={key}>
            {pad}
            <span className="text-blue-300">"{key}"</span>
            <span className="text-zinc-400">: </span>
            <JsonValue value={val} indent={indent + 1} />
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closePad}
        <span className="text-zinc-400">{"}"}</span>
      </span>
    );
  }
  return <span className="text-zinc-300">{String(value)}</span>;
}

function statusBadge(status: string, success?: boolean): string {
  if (status === "error" || success === false) return "bg-red-900/30 text-red-300";
  if (status === "aborted") return "bg-orange-900/30 text-orange-300";
  if (status === "streaming") return "bg-blue-900/30 text-blue-300";
  if (status === "success") return "bg-emerald-900/30 text-emerald-300";
  if (status === "completed") return "bg-emerald-900/30 text-emerald-300";
  return "bg-zinc-800 text-zinc-400";
}

function stepStatusBadge(status: string): string {
  if (status === "error") return "bg-red-900/30 text-red-300";
  if (status === "streaming") return "bg-blue-900/30 text-blue-300";
  if (status === "completed") return "bg-emerald-900/30 text-emerald-300";
  return "bg-zinc-800 text-zinc-400";
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n?: number): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-md">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 bg-zinc-800/20 hover:bg-zinc-700/30"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function TurnInspectorModal({ sessionId, turnNumber, onClose }: TurnInspectorModalProps) {
  const [turn, setTurn] = useState<TurnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<{ rawRequest: unknown; rawResponse: unknown } | null>(null);
  const [rawLoading, setRawLoading] = useState(true);
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawTab, setRawTab] = useState<"input" | "output">("input");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTurn(sessionId, turnNumber)
      .then((data) => {
        if (!cancelled) setTurn(data.turn);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId, turnNumber]);

  useEffect(() => {
    let cancelled = false;
    setRawLoading(true);
    setRawError(null);
    getTurnRaw(sessionId, turnNumber)
      .then((data) => {
        if (!cancelled) setRawData(data);
      })
      .catch((err) => {
        if (!cancelled) setRawError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRawLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId, turnNumber]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
          <div className="text-xs text-zinc-500 py-4 text-center">Loading turn data...</div>
        </div>
      </div>
    );
  }

  if (error || !turn) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
          <p className="text-zinc-400">{error || `Turn #${turnNumber} not found.`}</p>
          <button type="button" className="mt-4 text-sm text-zinc-400 hover:text-zinc-200" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-lg border border-zinc-800 flex flex-col max-h-[85vh] w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-zinc-200">
              Turn #{turn.turnNumber}
            </h2>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadge(turn.status, turn.success)}`}>
              {turn.status}
            </span>
            <span className="text-xs text-zinc-500">
              {formatDuration(turn.durationMs)}
            </span>
            {turn.agentName && (
              <span className="text-xs text-zinc-600">{turn.agentName}</span>
            )}
          </div>
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {/* Error message */}
          {turn.errorMessage && (
            <div className="rounded-md bg-red-950/30 border border-red-900/50 p-3">
              <div className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Error</div>
              <div className="text-xs text-red-300 whitespace-pre-wrap break-all">{turn.errorMessage}</div>
            </div>
          )}

          {/* User content */}
          <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">User Message</div>
            <div className="text-xs text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
              {turn.userContent}
            </div>
          </div>

          {/* Context */}
          {turn.contextTurnNumbers.length > 0 && (
            <Collapsible title="Context" defaultOpen={false}>
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-500">Context turns: </span>
                {turn.contextTurnNumbers.map((n) => (
                  <span key={n} className="inline-block bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5 mr-1 mb-1">
                    #{n}
                  </span>
                ))}
              </div>
            </Collapsible>
          )}

          {/* Steps table */}
          {turn.steps.length > 0 && (
            <Collapsible title={`Steps (${turn.steps.length})`} defaultOpen={true}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left py-1 px-2 font-medium">#</th>
                      <th className="text-left py-1 px-2 font-medium">Status</th>
                      <th className="text-left py-1 px-2 font-medium">Model</th>
                      <th className="text-right py-1 px-2 font-medium">In</th>
                      <th className="text-right py-1 px-2 font-medium">Out</th>
                      <th className="text-right py-1 px-2 font-medium">Total</th>
                      <th className="text-right py-1 px-2 font-medium">Step</th>
                      <th className="text-right py-1 px-2 font-medium">TTFO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turn.steps.map((step: StepSummary) => (
                      <tr key={step.stepIndex} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="py-1 px-2 text-zinc-400 font-mono">{step.stepIndex}</td>
                        <td className="py-1 px-2">
                          <span className={`text-[10px] px-1 py-0.5 rounded ${stepStatusBadge(step.status)}`}>
                            {step.status}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-zinc-400 truncate max-w-[120px]">{step.modelId || step.providerName || "—"}</td>
                        <td className="py-1 px-2 text-right text-zinc-400">{formatTokens(step.inputTokens)}</td>
                        <td className="py-1 px-2 text-right text-zinc-400">{formatTokens(step.outputTokens)}</td>
                        <td className="py-1 px-2 text-right text-zinc-400">{formatTokens(step.totalTokens)}</td>
                        <td className="py-1 px-2 text-right text-zinc-400">{formatDuration(step.stepTimeMs)}</td>
                        <td className="py-1 px-2 text-right text-zinc-400">{formatDuration(step.timeToFirstOutputMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Collapsible>
          )}

          {/* Tool Cache Hits */}
          {(turn.stepParts ?? []).some((p) => p.type === "tool") && (
            <Collapsible title="Tool Cache Hits" defaultOpen={true}>
              <ToolCacheGroups turn={turn} />
            </Collapsible>
          )}

          {/* System Prompt */}
          {turn.systemPrompt && (
            <Collapsible title="System Prompt">
              <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-[40vh] overflow-auto">
                {turn.systemPrompt}
              </pre>
            </Collapsible>
          )}

          {/* Tools */}
          {turn.tools && turn.tools.length > 0 && (
            <Collapsible title={`Tools (${turn.tools.length})`}>
              <div className="space-y-2">
                {turn.tools.map((tool) => (
                  <div key={tool.name} className="rounded bg-zinc-950 border border-zinc-800 p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-blue-300">{tool.name}</span>
                    </div>
                    {tool.description && (
                      <div className="text-[11px] text-zinc-400 mb-1">{tool.description}</div>
                    )}
                    {tool.parameters && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-zinc-500 cursor-pointer">parameters</summary>
                        <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all mt-1 pl-2 border-l border-zinc-800 max-h-[20vh] overflow-auto">
                          <JsonValue value={tool.parameters} />
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </Collapsible>
          )}

          {/* Raw Request/Response */}
          <Collapsible title="Raw Request/Response">
            <div className="space-y-2">
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  className={`text-xs px-2 py-1 rounded ${rawTab === "input" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
                  onClick={() => setRawTab("input")}
                >
                  Request
                </button>
                <button
                  type="button"
                  className={`text-xs px-2 py-1 rounded ${rawTab === "output" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
                  onClick={() => setRawTab("output")}
                >
                  Response
                </button>
              </div>
              {rawLoading && (
                <div className="text-xs text-zinc-500 py-4 text-center">Loading raw capture...</div>
              )}
              {rawError && (
                <div className="text-xs text-red-400 py-4 text-center">{rawError}</div>
              )}
              {!rawLoading && !rawError && rawData && (
                <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all bg-zinc-950 rounded p-3 max-h-[40vh] overflow-auto">
                  <JsonValue value={rawTab === "input" ? rawData.rawRequest : rawData.rawResponse} />
                </pre>
              )}
              {!rawLoading && !rawError && !rawData && (
                <div className="text-xs text-zinc-500 py-4 text-center">No raw capture available.</div>
              )}
            </div>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
