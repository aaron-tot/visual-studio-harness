import { useState, useEffect, useMemo } from "react";
import { Plus, Edit3, Trash2, FileText } from "lucide-react";
import type { MdEntry } from "../../lib/api";
import type { SessionMeta } from "../../../_shared/types";
import { listMds, readMd, deleteMd } from "../../lib/api";
import { useSessionStore } from "../../stores/sessions";
import { MdEditorModal } from "./MdEditorModal";
import { formatStats } from "../../lib/md-stats";

interface MdManagerProps {
  sessionId?: string;
}

const TAG_LABELS: Record<string, string> = {
  global: "Global",
  system: "System",
  agent: "Agent",
  skill: "Skill",
};

const TAG_COLORS: Record<string, string> = {
  global: "text-purple-400 bg-purple-400/10",
  system: "text-blue-400 bg-blue-400/10",
  agent: "text-amber-400 bg-amber-400/10",
  skill: "text-emerald-400 bg-emerald-400/10",
};

function tagBadge(tag: string) {
  const label = TAG_LABELS[tag] || tag;
  const color = TAG_COLORS[tag] || "text-zinc-400 bg-zinc-400/10";
  return (
    <span key={tag} className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${color}`}>
      {label}
    </span>
  );
}

function shortPath(p: string) {
  if (p.length <= 48) return p;
  return "…" + p.slice(-46);
}

const OTHER_KEY = "(Other)";

export function MdManager({ sessionId }: MdManagerProps) {
  const [entries, setEntries] = useState<Record<string, MdEntry[]>>({});
  const [roots, setRoots] = useState<{ mds: string; workspace: string }>({ mds: "", workspace: "" });
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMd, setEditingMd] = useState<{ path: string; tag: string; content: string; source?: string } | null>(null);
  const sessions = useSessionStore((s) => s.sessions);
  const fetchSessions = useSessionStore((s) => s.fetch);
  const [selectedSessionId, setSelectedSessionId] = useState(sessionId || "");
  const hasSession = Boolean(sessionId);

  useEffect(() => {
    if (sessions.length === 0) fetchSessions();
  }, []);

  const workspaceGroups = useMemo(() => {
    const groups: Record<string, SessionMeta[]> = {};
    for (const s of sessions) {
      const key = s.workspaceRoot?.trim() || OTHER_KEY;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [sessions]);

  const workspaceKeys = useMemo(
    () => Object.keys(workspaceGroups).sort((a, b) => (a === OTHER_KEY ? 1 : b === OTHER_KEY ? -1 : a.localeCompare(b))),
    [workspaceGroups]
  );

  const [selectedWorkspace, setSelectedWorkspace] = useState("");

  const filteredSessions = useMemo(
    () => (selectedWorkspace ? workspaceGroups[selectedWorkspace] || [] : sessions),
    [selectedWorkspace, workspaceGroups, sessions]
  );

  useEffect(() => {
    if (!hasSession || !filteredSessions.length) return;
    if (!selectedSessionId || !filteredSessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [filteredSessions, hasSession]);

  useEffect(() => {
    if (sessionId && sessions.length > 0 && selectedWorkspace === "") {
      const s = sessions.find((s) => s.id === sessionId);
      if (s) setSelectedWorkspace(s.workspaceRoot?.trim() || OTHER_KEY);
    }
  }, [sessions]);

  const activeSessionId = hasSession ? selectedSessionId : "";

  useEffect(() => {
    setLoading(true);
    listMds(activeSessionId)
      .then((res) => {
        setEntries(res.entries);
        setRoots(res.roots);
      })
      .catch(() => setEntries({}))
      .finally(() => setLoading(false));
  }, [activeSessionId]);

  const handleEdit = async (fullPath: string, source?: string, tags?: string[]) => {
    try {
      const { content } = await readMd(activeSessionId, fullPath);
      setEditingMd({ path: fullPath, tag: tags?.[0] ?? "", content, source });
      setEditorOpen(true);
    } catch (e) {
      console.error("Failed to read MD", e);
    }
  };

  const handleDelete = async (fullPath: string) => {
    if (!confirm(`Delete ${fullPath}?`)) return;
    try {
      await deleteMd(activeSessionId, fullPath);
      setEntries((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          next[key] = next[key].filter((e) => e.fullPath !== fullPath);
        }
        return next;
      });
    } catch (e) {
      console.error("Failed to delete MD", e);
    }
  };

  const handleSaved = () => {
    setEditorOpen(false);
    setEditingMd(null);
    listMds(activeSessionId).then((res) => {
      setEntries(res.entries);
      setRoots(res.roots);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {hasSession ? (
        <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <select
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              className="bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-700 max-w-[180px]"
              title={selectedWorkspace}
            >
              <option value="">All sessions</option>
              {workspaceKeys.map((key) => (
                <option key={key} value={key}>
                  {key === OTHER_KEY ? OTHER_KEY : shortPath(key)}
                </option>
              ))}
            </select>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="bg-zinc-800 text-zinc-200 text-xs rounded px-2 py-1 border border-zinc-700 flex-1 min-w-0"
            >
              {filteredSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!selectedSessionId}
            onClick={() => {
              setEditingMd(null);
              setEditorOpen(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            <Plus size={14} />
            Create MD
          </button>
        </div>
      ) : (
        <div className="pb-3 border-b border-zinc-800">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Global MD Files</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-3 space-y-4">
        {loading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : Object.keys(entries).length === 0 ? (
          <p className="text-sm text-zinc-500">No MD files</p>
        ) : (
          Object.entries(entries).map(([key, mds]) => {
            if (mds.length === 0) return null;
            const sectionLabel = key === "workspace" ? "Project" : key.replace(/^data\./, "Data ");
            return (
              <div key={key}>
                <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                  {sectionLabel}
                </h3>
                <div className="space-y-0.5">
                  {mds.map((md) => {
                    const displayName = md.path.split("/").pop() || md.path;
                    return (
                      <div
                        key={md.path}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50 group"
                      >
                        <FileText size={14} className="text-zinc-500 shrink-0" />
                        <span className="text-sm text-zinc-200 truncate flex-1">{displayName}</span>
                        {md.stats && (
                          <span className="text-[10px] text-zinc-500 shrink-0">
                            {formatStats(md.stats)}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          {md.tags.map((t) => tagBadge(t))}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleEdit(md.fullPath, key, md.tags)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-zinc-200"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(md.fullPath)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {editorOpen && (
        <MdEditorModal
          sessionId={activeSessionId}
          roots={roots}
          initialMd={editingMd || undefined}
          onClose={() => {
            setEditorOpen(false);
            setEditingMd(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}


