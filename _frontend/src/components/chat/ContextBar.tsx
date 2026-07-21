import { useSessionViewStore } from "../../stores/sessionView";

export function ContextBar() {
  const context = useSessionViewStore((s) => s.sessionContext);
  const removeContext = useSessionViewStore((s) => s.removeContext);

  if (context.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-zinc-800 overflow-x-auto">
      {context.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-400 shrink-0 group cursor-pointer hover:bg-zinc-700"
          title={doc.label}
        >
          <span className="font-medium text-zinc-500">{doc.type === "spec" ? "S" : "P"}</span>
          <span className="truncate max-w-[80px]">{doc.planName}</span>
          <span className="text-zinc-600">v{doc.version}</span>
          <button
            className="ml-0.5 text-zinc-600 hover:text-zinc-300 transition-colors leading-none"
            onClick={(e) => { e.stopPropagation(); removeContext(doc.id); }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
