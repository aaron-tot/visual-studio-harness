import { Plus, Trash2 } from "lucide-react";
import type { ResearchPoint, ResearchConfidence } from "../../../../lib/api";

const CONFIDENCE_OPTIONS: ResearchConfidence[] = [
  "high",
  "medium",
  "low",
  "speculative",
];

export function emptyPoint(): ResearchPoint {
  return {
    id: crypto.randomUUID(),
    question: "",
    answer: "",
    verbatimQuotes: [],
    summary: "",
    searchedAt: new Date().toISOString(),
    confidence: "medium",
  };
}

export function ResearchPointSection({
  title,
  points,
  onUpdate,
}: {
  title: string;
  points: ResearchPoint[];
  onUpdate: (points: ResearchPoint[]) => void;
}) {
  const updatePoint = (id: string, field: keyof ResearchPoint, value: string | string[] | ResearchConfidence) => {
    onUpdate(points.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const removePoint = (id: string) => {
    onUpdate(points.filter((p) => p.id !== id));
  };

  const addPoint = () => {
    onUpdate([...points, emptyPoint()]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400">{title}</h3>
        <button
          type="button"
          className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors flex items-center gap-0.5"
          onClick={addPoint}
        >
          <Plus size={10} />
          Add Point
        </button>
      </div>
      {points.length === 0 && (
        <p className="text-[10px] text-zinc-600 italic">No points yet</p>
      )}
      {points.map((pt, idx) => (
        <div key={pt.id} className="border border-zinc-700 rounded p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-medium">Point {idx + 1}</span>
            <button
              type="button"
              className="text-zinc-600 hover:text-red-400 transition-colors"
              onClick={() => removePoint(pt.id)}
            >
              <Trash2 size={10} />
            </button>
          </div>

          <div>
            <label className="text-[10px] text-zinc-500 block">Question</label>
            <input
              type="text"
              className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
              value={pt.question}
              onChange={(e) => updatePoint(pt.id, "question", e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] text-zinc-500 block">Answer</label>
            <textarea
              className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500 resize-y min-h-[48px]"
              rows={2}
              value={pt.answer}
              onChange={(e) => updatePoint(pt.id, "answer", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[10px] text-zinc-500 block">Source URL</label>
              <input
                type="text"
                className="w-full text-[10px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
                value={pt.sourceUrl ?? ""}
                onChange={(e) =>
                  updatePoint(pt.id, "sourceUrl", e.target.value || (undefined as any))
                }
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block">Source Path</label>
              <input
                type="text"
                className="w-full text-[10px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
                value={pt.sourcePath ?? ""}
                onChange={(e) =>
                  updatePoint(pt.id, "sourcePath", e.target.value || (undefined as any))
                }
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-zinc-500 block">Summary</label>
            <input
              type="text"
              className="w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
              value={pt.summary}
              onChange={(e) => updatePoint(pt.id, "summary", e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] text-zinc-500 block">Verbatim quotes</label>
            <textarea
              className="w-full text-[10px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500 resize-y min-h-[32px]"
              rows={1}
              placeholder="One quote per line"
              value={pt.verbatimQuotes.join("\n")}
              onChange={(e) =>
                updatePoint(
                  pt.id,
                  "verbatimQuotes",
                  e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[10px] text-zinc-500 block">Confidence</label>
              <select
                className="w-full text-[10px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
                value={pt.confidence}
                onChange={(e) => updatePoint(pt.id, "confidence", e.target.value as ResearchConfidence)}
              >
                {CONFIDENCE_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block">Searched at</label>
              <input
                type="datetime-local"
                className="w-full text-[10px] bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none border border-zinc-700 focus:border-zinc-500"
                value={pt.searchedAt.slice(0, 16)}
                onChange={(e) => updatePoint(pt.id, "searchedAt", new Date(e.target.value).toISOString())}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
