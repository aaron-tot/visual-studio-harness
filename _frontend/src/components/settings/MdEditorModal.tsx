import { useState, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { createMd, updateMd, deleteMd } from "../../lib/api";
import { calculateMdStats, formatStats } from "../../lib/md-stats";

interface MdEditorModalProps {
  sessionId: string;
  roots: { mds: string; workspace: string };
  initialMd?: { path: string; tag: string; content: string; source?: string };
  onClose: () => void;
  onSaved: () => void;
}

const TAGS = ["system", "agent", "skill"] as const;
type Location = "global" | "workspace";

export function MdEditorModal({ sessionId, roots, initialMd, onClose, onSaved }: MdEditorModalProps) {
  const isEditing = !!initialMd;
  const [filePath, setFilePath] = useState("");
  const [tag, setTag] = useState<string>("system");
  const [location, setLocation] = useState<Location>("global");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [createName, setCreateName] = useState("");
  const [userTouchedPath, setUserTouchedPath] = useState(false);

  useEffect(() => {
    if (isEditing && initialMd) {
      setFilePath(initialMd.path);
      setTag(initialMd.tag || "system");
      const isGlobal = initialMd.path.startsWith(roots.mds);
      setLocation(isGlobal ? "global" : "workspace");
      setContent(initialMd.content);
      setUserTouchedPath(false);
    } else if (roots.mds) {
      setFilePath(roots.mds + "/system/untitled.md");
      setCreateName("untitled");
      setLocation("global");
      setUserTouchedPath(false);
    }
  }, [initialMd, roots]);

  function isInsideRoot(p: string): { inside: boolean; root?: string } {
    if (roots.mds && p.startsWith(roots.mds)) return { inside: true, root: roots.mds };
    if (roots.workspace && p.startsWith(roots.workspace)) return { inside: true, root: roots.workspace };
    return { inside: false };
  }

  function handleTagChange(newTag: string) {
    setTag(newTag);
    if (!userTouchedPath) {
      const name = createName || filePath.split("/").pop()?.replace(/\.md$/, "") || "untitled";
      if (location === "global") {
        const base = roots.mds || "";
        setFilePath(base + "/" + newTag + "/" + name + ".md");
      } else {
        const base = roots.workspace || "";
        setFilePath(base + "/" + name + ".md");
      }
    }
  }

  function handleLocationChange(newLocation: Location) {
    setLocation(newLocation);
    if (!userTouchedPath) {
      const name = createName || filePath.split("/").pop()?.replace(/\.md$/, "") || "untitled";
      if (newLocation === "global") {
        setFilePath(roots.mds + "/" + tag + "/" + name + ".md");
      } else {
        setFilePath(roots.workspace + "/" + name + ".md");
      }
    }
  }

  function handleNameChange(name: string) {
    setCreateName(name);
    if (!userTouchedPath) {
      if (location === "global") {
        const base = roots.mds || "";
        setFilePath(base + "/" + tag + "/" + (name || "untitled") + ".md");
      } else {
        const base = roots.workspace || "";
        setFilePath(base + "/" + (name || "untitled") + ".md");
      }
    }
  }

  const doSave = async () => {
    if (!filePath.trim()) return;
    setSaving(true);
    try {
      if (isEditing && initialMd) {
        const newPath = filePath !== initialMd.path ? filePath : undefined;
        await updateMd(sessionId, initialMd.path, {
          newPath,
          content,
          tags: [tag],
        });
      } else {
        await createMd(sessionId, filePath, content, [tag]);
      }
      onSaved();
    } catch (e) {
      console.error("Failed to save MD", e);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!filePath.trim()) return;
    const { inside } = isInsideRoot(filePath);
    if (!inside && roots.mds) {
      setShowWarning(true);
      setPendingAction(() => doSave);
    } else {
      doSave();
    }
  };

  const handleSaveOutside = () => {
    setShowWarning(false);
    if (pendingAction) pendingAction();
  };

  const handleUseMds = () => {
    setShowWarning(false);
    const parts = filePath.split("/");
    const name = parts.pop() || "untitled.md";
    setFilePath(roots.mds + "/untagged/" + name);
  };

  const handleUseWorkspace = () => {
    setShowWarning(false);
    if (roots.workspace) {
      const parts = filePath.split("/");
      const name = parts.pop() || "untitled.md";
      setFilePath(roots.workspace + "/" + name);
    }
  };

  const handleDelete = async () => {
    if (!initialMd) return;
    if (!confirm(`Delete ${initialMd.path}?`)) return;
    setSaving(true);
    try {
      await deleteMd(sessionId, initialMd.path);
      onSaved();
    } catch (e) {
      console.error("Failed to delete MD", e);
    } finally {
      setSaving(false);
    }
  };

  const fileName = filePath.replace(/\/$/, "").split("/").pop() || "";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      onClick={onClose}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-800 rounded-lg w-[720px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-200">
            {isEditing ? `Edit ${fileName.replace(/\.md$/, "")}` : "Create MD File"}
          </h2>
          <button onClick={onClose} type="button" className="text-zinc-400 hover:text-zinc-200 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex gap-3">
            <div className="w-32">
              <label className="block text-xs text-zinc-500 mb-1">Location</label>
              <select
                value={location}
                onChange={(e) => handleLocationChange(e.target.value as Location)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                <option value="global">Global</option>
                <option value="workspace">Workspace</option>
              </select>
            </div>
            {!isEditing && (
              <div className="flex-1">
                <label className="block text-xs text-zinc-500 mb-1">Filename</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="my-rules"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-500"
                />
              </div>
            )}
            <div className="w-32">
              <label className="block text-xs text-zinc-500 mb-1">Tag</label>
              <select
                value={tag}
                onChange={(e) => handleTagChange(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
              >
                {TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">File path</label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => {
                setFilePath(e.target.value);
                setUserTouchedPath(true);
              }}
              placeholder="/path/to/file.md"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 font-mono placeholder-zinc-500"
            />
            {roots.mds && (
              <p className="text-[10px] text-zinc-600 mt-0.5">
                Files under <code className="text-zinc-500">{roots.mds}</code> or{" "}
                {roots.workspace ? (
                  <code className="text-zinc-500">{roots.workspace}</code>
                ) : "(no workspace)"} will be detected automatically.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Content (Markdown)</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-200 font-mono resize-none h-[60vh] overflow-y-auto"
              placeholder="# My MD File\n\nWrite your markdown content here..."
            />
          </div>
        </div>

        {showWarning && (
          <div className="mx-4 mb-2 p-3 rounded bg-amber-900/30 border border-amber-700/50">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-200 space-y-2">
                <p>
                  This path is outside the scan locations. The file will be saved but won't appear in
                  the MD list or be used by the LLM.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleSaveOutside}
                    className="px-2 py-1 text-[11px] rounded bg-amber-700 text-amber-100 hover:bg-amber-600"
                  >
                    Save anyway
                  </button>
                  <button
                    type="button"
                    onClick={handleUseMds}
                    className="px-2 py-1 text-[11px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                  >
                    Use MDS path
                  </button>
                  {roots.workspace && (
                    <button
                      type="button"
                      onClick={handleUseWorkspace}
                      className="px-2 py-1 text-[11px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
                    >
                      Use workspace root
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowWarning(false)}
                    className="px-2 py-1 text-[11px] rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800">
          <div className="flex-1 text-[10px] text-zinc-500">
            {formatStats(calculateMdStats(content))}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !filePath.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
