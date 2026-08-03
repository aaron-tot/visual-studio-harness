import { useState } from "react";
import { X } from "lucide-react";
import type { CustomTool } from "../../lib/api";
import { createCustomTool, updateCustomTool } from "../../lib/api";

type ModalMode = { mode: "create"; tool?: undefined } | { mode: "edit"; tool: CustomTool };

interface Props {
  mode: "create" | "edit";
  tool?: CustomTool;
  onClose: () => void;
  onSaved: () => void;
}

export function CustomToolModal({ mode, tool, onClose, onSaved }: Props) {
  const [name, setName] = useState(tool?.name ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [schemaRaw, setSchemaRaw] = useState(JSON.stringify(tool?.inputSchema ?? { type: "object", properties: {} }, null, 2));
  const defaultCode = [
    "// args: tool input parameters, ctx: { sessionId, workspaceRoot, dataDir, callId }",
    "// Return: string | { output: string, isError?: boolean }",
    "return args.toolName ?? 'Hello from custom-tool!';",
  ].join("\n");
  const [code, setCode] = useState(tool?.code ?? defaultCode);
  const [enabled, setEnabled] = useState(tool?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name.trim())) {
      setError("Name must start with alphanumeric, 1-64 chars, hyphens/underscores allowed");
      return;
    }
    if (!code.trim()) { setError("Code is required"); return; }
    let inputSchema: Record<string, unknown>;
    try { inputSchema = JSON.parse(schemaRaw); } catch { setError("Invalid JSON in schema"); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), inputSchema, code, enabled };
      if (mode === "create") await createCustomTool(payload);
      else await updateCustomTool(tool!.name, payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[85vh] w-[700px] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-100">{mode === "create" ? "New Custom Tool" : `Edit: ${tool!.name}`}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="mb-3 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100" placeholder="my-custom-tool" disabled={mode === "edit"} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100" placeholder="What this tool does (shown to the LLM)" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-zinc-400">Input Schema (JSON)</label>
              <button onClick={() => setSchemaRaw(JSON.stringify({ type: "object", properties: { name: { type: "string", description: "Name to greet" } }, required: ["name"] }, null, 2))} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"><span className="mr-0.5 text-xs">2295</span> Sample</button>
            </div>
            <textarea value={schemaRaw} onChange={(e) => setSchemaRaw(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-100" rows={6} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs text-zinc-400">Code</label>
              <button onClick={() => setCode(["// args: { name: string }", "// ctx: { sessionId, workspaceRoot, dataDir, callId }", "return `Hello, ${args.name}!`;"].join("\n"))} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200"><span className="mr-0.5 text-xs">2295</span> Sample</button>
            </div>
            <textarea value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-100" rows={10} />
            <p className="mt-0.5 text-[10px] text-zinc-500">Function body receives (args, ctx). Return string or &#123; output, isError &#125;. Context: sessionId, workspaceRoot, dataDir, callId.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEnabled(!enabled)} className={`rounded px-2 py-1 text-xs ${enabled ? "bg-green-900/30 text-green-400" : "bg-zinc-800 text-zinc-500"}`}>{enabled ? "Enabled" : "Disabled"}</button>
            <span className="text-xs text-zinc-500">Only enabled tools are available to agents</span>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => void handleSave()} disabled={saving} className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-50">{saving ? "Saving..." : mode === "create" ? "Create" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
