import { useState } from "react";
import { X, FileText, HelpCircle } from "lucide-react";
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
  const [skillGuide, setSkillGuide] = useState(tool?.skillGuide ?? "");
  const [skillPushMode, setSkillPushMode] = useState<"soft" | "hard" | "custom">(tool?.skillPushMode ?? "soft");
  const [skillPushText, setSkillPushText] = useState(tool?.skillCustomPushText ?? tool?.skillPushText ?? "");
  const [skillId, setSkillId] = useState(tool?.skillId ?? "");
  const [showSkillEditor, setShowSkillEditor] = useState(!!tool?.skillGuide);
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
      const payload = {
        name: name.trim(),
        description: description.trim(),
        inputSchema,
        code,
        enabled,
        skillGuide: showSkillEditor ? skillGuide.trim() : undefined,
        skillPushMode: showSkillEditor ? skillPushMode : undefined,
        skillCustomPushText: showSkillEditor && skillPushMode === "custom" ? skillPushText.trim() : undefined,
        skillId: showSkillEditor && skillId.trim() ? skillId.trim() : undefined,
      };
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

          {/* Skill Guide Section */}
          <div className="border-t border-zinc-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-zinc-400 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Skill Guide (optional)
              </label>
              <button
                type="button"
                onClick={() => setShowSkillEditor(!showSkillEditor)}
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded ${showSkillEditor ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >
                {showSkillEditor ? (
                  <>
                    <HelpCircle className="h-3 w-3" /> Hide
                  </>
                ) : (
                  <>
                    <span className="mr-0.5 text-xs">+</span> Add Skill Guide
                  </>
                )}
              </button>
            </div>

            {showSkillEditor && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Skill ID (defaults to tool name)</label>
                  <input
                    type="text"
                    value={skillId}
                    onChange={(e) => setSkillId(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100"
                    placeholder="my-custom-tool"
                  />
                  <p className="mt-0.5 text-[10px] text-zinc-500">Agent reads this skill via the skill tool using this ID.</p>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Push Mode</label>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="skill-push-mode"
                        value="soft"
                        checked={skillPushMode === "soft"}
                        onChange={() => setSkillPushMode("soft")}
                        className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
                      />
                      <span className="text-xs text-zinc-300">Soft</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="skill-push-mode"
                        value="hard"
                        checked={skillPushMode === "hard"}
                        onChange={() => setSkillPushMode("hard")}
                        className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
                      />
                      <span className="text-xs text-zinc-300">Hard</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="skill-push-mode"
                        value="custom"
                        checked={skillPushMode === "custom"}
                        onChange={() => setSkillPushMode("custom")}
                        className="rounded border-zinc-600 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
                      />
                      <span className="text-xs text-zinc-300">Custom</span>
                    </label>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-500">
                    {skillPushMode === "soft"
                      ? 'Soft: "A skill guide exists... You may read it if needed."'
                      : skillPushMode === "hard"
                      ? 'Hard: "MUST read the skill guide... before using this tool."'
                      : 'Custom: Use your own text below.'}
                  </p>
                </div>

                {skillPushMode === "custom" && (
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Custom Push Text</label>
                    <textarea
                      value={skillPushText}
                      onChange={(e) => setSkillPushText(e.target.value)}
                      className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-100"
                      rows={3}
                      placeholder='e.g., "Before using this tool, read the skill guide (ID: my-tool) for best practices."'
                    />
                    <p className="mt-0.5 text-[10px] text-zinc-500">This text will be appended to the tool description when the agent sees it.</p>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs text-zinc-400">Skill Guide Content (Markdown)</label>
                  <textarea
                    value={skillGuide}
                    onChange={(e) => setSkillGuide(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-mono text-zinc-100"
                    rows={8}
                    placeholder="# My Tool Skill Guide\n\n## When to Use\nUse this tool when...\n\n## Parameters\n- \`arg1\`: ...\n\n## Examples\n..."
                  />
                </div>
              </div>
            )}
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
