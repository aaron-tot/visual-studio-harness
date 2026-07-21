import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import type { SnippetConfig } from "../../../../_shared/types";
import { ALL_SHORTCUT_DEFS } from "../../hooks/useShortcut";

const CATEGORIES = [...new Set(ALL_SHORTCUT_DEFS.map((s) => s.category))];

function labelFromKeys(keys: string): string {
  if (!keys) return "\u2014";
  return keys
    .replace("ArrowLeft", "\u2190")
    .replace("ArrowRight", "\u2192")
    .replace("ArrowUp", "\u2191")
    .replace("ArrowDown", "\u2193");
}

export function ShortcutsPanel() {
  const config = useConfigStore((s) => s.config);
  const updateConfig = useConfigStore((s) => s.update);
  const keybindings = { ...(config.keybindings || {}) };
  const snippets = config.snippets ?? [];

  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [recordBuf, setRecordBuf] = useState("");

  const [editingSnippet, setEditingSnippet] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");

  const currentKeys = (id: string): string => keybindings[id] ?? ALL_SHORTCUT_DEFS.find((d) => d.id === id)?.defaultKeys ?? "";

  const setKeys = (id: string, combo: string) => {
    const next = { ...keybindings };
    const def = ALL_SHORTCUT_DEFS.find((d) => d.id === id)?.defaultKeys;
    if (combo === "" || combo === def) {
      delete next[id];
    } else {
      next[id] = combo;
    }
    updateConfig({ ...config, keybindings: next });
  };

  const startRecording = (id: string) => {
    setEditingShortcut(id);
    setRecordBuf("");
  };

  const onRecordKey = (e: React.KeyboardEvent) => {
    if (!editingShortcut) return;
    e.preventDefault();
    e.stopPropagation();
    const mods: string[] = [];
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.ctrlKey) mods.push("Control");
    if (e.metaKey) mods.push("Meta");
    const key = e.key;
    if (key === "Alt" || key === "Shift" || key === "Control" || key === "Meta") return;
    if (key === "Enter") { confirmRecord(); return; }
    if (key === "Escape") { setEditingShortcut(null); setRecordBuf(""); return; }
    setRecordBuf(mods.length > 0 ? [...mods, key].join("+") : key);
  };

  const confirmRecord = () => {
    if (editingShortcut && recordBuf) {
      setKeys(editingShortcut, recordBuf);
    }
    setEditingShortcut(null);
    setRecordBuf("");
  };

  const unbind = (id: string) => {
    setKeys(id, "");
    setEditingShortcut(null);
    setRecordBuf("");
  };

  const saveSnippets = async (next: SnippetConfig[]) => {
    const current = useConfigStore.getState().config;
    await updateConfig({ ...current, snippets: next });
  };

  const startAdd = () => { setAdding(true); setNewName(""); setNewContent(""); };

  const confirmAdd = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    await saveSnippets([...snippets, { name: newName.trim(), content: newContent.trim() }]);
    setAdding(false);
  };

  const startEditSnippet = (idx: number) => {
    const s = snippets[idx];
    setEditingSnippet(idx);
    setEditName(s.name);
    setEditContent(s.content);
  };

  const confirmEditSnippet = async () => {
    if (editingSnippet === null || !editName.trim() || !editContent.trim()) return;
    const next = snippets.map((s, i) => i === editingSnippet ? { name: editName.trim(), content: editContent.trim() } : s);
    await saveSnippets(next);
    setEditingSnippet(null);
  };

  const removeSnippet = async (idx: number) => {
    await saveSnippets(snippets.filter((_, i) => i !== idx));
    if (editingSnippet === idx) setEditingSnippet(null);
  };

  const moveSnippet = async (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= snippets.length) return;
    const next = [...snippets];
    [next[idx], next[to]] = [next[to], next[idx]];
    await saveSnippets(next);
    if (editingSnippet === idx) setEditingSnippet(to);
  };

  return (
    <div className="min-h-0 flex flex-col space-y-6">
      <div>
        <h2 className="text-sm font-medium text-zinc-100 mb-1">Keyboard Shortcuts</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Click a shortcut to record a new key combination. Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">Enter</kbd> to confirm, <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">Escape</kbd> to cancel. Click the × to unbind.
        </p>
        {CATEGORIES.map((cat) => (
          <div key={cat} className="mb-3">
            <h3 className="text-xs font-medium text-zinc-600 uppercase tracking-wider mb-1.5">{cat}</h3>
            <div className="space-y-0.5">
              {ALL_SHORTCUT_DEFS.filter((s) => s.category === cat).map((sc) => {
                const isEditing = editingShortcut === sc.id;
                const current = isEditing ? recordBuf : currentKeys(sc.id);
                const isDefault = !keybindings[sc.id] || keybindings[sc.id] === sc.defaultKeys;
                const isDisabled = !isEditing && !current;
                return (
                  <div key={sc.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-zinc-900 transition-colors group">
                    <span className="flex-1 text-xs text-zinc-400">{sc.label}</span>
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input className="w-28 text-[11px] font-mono bg-zinc-800 text-zinc-200 px-2 py-1 rounded outline-none placeholder-zinc-600" placeholder="Press keys..." value={recordBuf} onKeyDown={onRecordKey} onChange={() => {}} onBlur={() => { setTimeout(() => setEditingShortcut(null), 200); }} autoFocus />
                          <span className="text-[10px] text-zinc-600">Enter ↵</span>
                        </div>
                      ) : (
                        <button className={`text-[11px] font-mono px-2 py-1 rounded transition-colors min-w-[7rem] text-center ${isDisabled ? "text-zinc-700 bg-zinc-900 line-through" : isDefault ? "text-zinc-300 bg-zinc-800 hover:bg-zinc-700" : "text-amber-300 bg-zinc-800 hover:bg-zinc-700"}`} onClick={() => startRecording(sc.id)} title="Click to rebind">
                          {isDisabled ? "unbound" : labelFromKeys(current)}
                        </button>
                      )}
                      {!isEditing && current && !isDefault && (
                        <button className="text-[10px] text-zinc-700 hover:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setKeys(sc.id, "")} title="Reset to default">↺</button>
                      )}
                      {!isEditing && (
                        <button className="text-[10px] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100" onClick={() => unbind(sc.id)} title="Unbind">×</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800" />

      <div>
        <h2 className="text-sm font-medium text-zinc-100 mb-1">Text Snippets</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Hold <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">Alt</kbd>{" "} and scroll the mouse wheel over the chat input to pick and insert a snippet.
        </p>
        <div className="space-y-2">
          {snippets.length === 0 && !adding && <p className="text-xs text-zinc-600 italic">No snippets saved yet.</p>}
          {snippets.map((snippet, idx) => (
            <div key={idx} className="border border-zinc-800 rounded-lg overflow-hidden">
              {editingSnippet === idx ? (
                <div className="p-3 space-y-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Snippet name" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" autoFocus />
                  <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="Snippet content" rows={3} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 font-mono resize-y focus:outline-none focus:border-zinc-500" />
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setEditingSnippet(null)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
                    <button type="button" onClick={confirmEditSnippet} className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500">Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 p-2 group">
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <button type="button" onClick={() => moveSnippet(idx, -1)} disabled={idx === 0} className="p-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:cursor-not-allowed"><ChevronUp size={12} /></button>
                    <button type="button" onClick={() => moveSnippet(idx, 1)} disabled={idx === snippets.length - 1} className="p-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-20 disabled:cursor-not-allowed"><ChevronDown size={12} /></button>
                  </div>
                  <button type="button" onClick={() => startEditSnippet(idx)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm text-zinc-200 truncate">{snippet.name}</div>
                    <div className="text-xs text-zinc-500 truncate mt-0.5">{snippet.content}</div>
                  </button>
                  <button type="button" onClick={() => removeSnippet(idx)} className="p-1.5 text-zinc-500 hover:text-red-400 rounded hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete snippet"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
          {adding && (
            <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Snippet name" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" autoFocus />
              <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Snippet content" rows={3} className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 font-mono resize-y focus:outline-none focus:border-zinc-500" />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
                <button type="button" onClick={confirmAdd} className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500">Add</button>
              </div>
            </div>
          )}
        </div>
        {!adding && (
          <button type="button" onClick={startAdd} className="mt-3 flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-dashed border-zinc-700 rounded-lg hover:border-zinc-500 transition-colors">
            <Plus size={14} /> Add snippet
          </button>
        )}
      </div>
    </div>
  );
}
