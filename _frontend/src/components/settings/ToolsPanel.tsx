import { useCallback, useEffect, useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import {
  getTools,
  getGlobalPerms,
  putGlobalPerms,
  getWorkspacePerms,
  putWorkspacePerms,
  getSessionPerms,
  putSessionPerms,
  getSession,
  resetGlobalPerms,
  EXTERNAL_DIRECTORY_PREFIX,
  type ToolMeta,
  type PermissionMode,
} from "../../lib/api";
import { PermModeSelect } from "./PermModeSelect";
import { SubagentSettingsCard } from "./SubagentSettingsCard";

type PermLayer = "global" | "workspace" | "session";

function useLayerPerms(layer: PermLayer, sessionId: string, workspaceRoot: string) {
  const [perms, setPerms] = useState<Record<string, PermissionMode>>({});
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async (l: PermLayer) => {
    setLoading(true);
    setError(null);
    try {
      if (l === "global") {
        const res = await getGlobalPerms();
        setPerms({ ...res.tools });
        setPath(res.path);
      } else if (l === "workspace" && workspaceRoot) {
        const res = await getWorkspacePerms(workspaceRoot);
        setPerms({ ...res.tools });
        setPath(res.path);
      } else if (l === "session" && sessionId) {
        const res = await getSessionPerms(sessionId);
        setPerms({ ...res.tools });
        setPath(res.path);
      } else {
        setPerms({});
        setPath("");
      }
    } catch (e) {
      setPerms({});
      setPath("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId, workspaceRoot]);

  const save = useCallback(async (next: Record<string, PermissionMode>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setError(null);
    try {
      setPerms(next);
      let res;
      if (layer === "global") {
        res = await putGlobalPerms(next);
      } else if (layer === "workspace" && workspaceRoot) {
        res = await putWorkspacePerms(workspaceRoot, next);
      } else if (layer === "session" && sessionId) {
        res = await putSessionPerms(sessionId, next);
      }
      if (res) setPerms({ ...res.tools });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      savingRef.current = false;
    }
  }, [layer, sessionId, workspaceRoot]);

  const clear = useCallback(async () => {
    setPerms({});
    setError(null);
    if (layer !== "global") {
      if (layer === "workspace" && workspaceRoot) {
        await putWorkspacePerms(workspaceRoot, {});
      } else if (layer === "session" && sessionId) {
        await putSessionPerms(sessionId, {});
      }
    }
  }, [layer, sessionId, workspaceRoot]);

  return { perms, setPerms, path, loading, error, load, save, clear, savingRef };
}

const LAYER_LABELS: Record<PermLayer, string> = {
  global: "Global",
  workspace: "Current workspace",
  session: "Current session",
};

interface Props {
  sessionId: string;
}

export function ToolsPanel({ sessionId }: Props) {
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [ready, setReady] = useState(false);
  const hasSession = !!sessionId;
  const [layer, setLayer] = useState<PermLayer>("global");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [openDesc, setOpenDesc] = useState<Record<string, boolean>>({});
  const [openInput, setOpenInput] = useState<Record<string, boolean>>({});
  const [openOutput, setOpenOutput] = useState<Record<string, boolean>>({});
  const [openSettings, setOpenSettings] = useState<Record<string, boolean>>({});
  const [openExt, setOpenExt] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const lp = useLayerPerms(layer, sessionId, workspaceRoot);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const toolsRes = await getTools();
        if (cancelled) return;
        setTools(toolsRes.tools);
        if (sessionId) {
          const session = await getSession(sessionId);
          if (!cancelled) setWorkspaceRoot(session.meta.workspaceRoot || "");
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) console.error("Failed to load tools", e);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (ready) void lp.load(layer);
  }, [ready, layer, lp.load]);

  const switchLayer = (l: PermLayer) => {
    setLayer(l);
    setMsg(null);
  };

  const onChangePerm = (name: string, mode: PermissionMode) => {
    if (!mode || lp.savingRef.current) return;
    void lp.save({ ...lp.perms, [name]: mode });
  };

  const onInherit = (name: string) => {
    if (lp.savingRef.current) return;
    const next = { ...lp.perms };
    delete next[name];
    void lp.save(next);
  };

  const onReset = async () => {
    if (layer === "global") {
      if (!confirm("Reset global permissions to defaults?")) return;
      await resetGlobalPerms();
      await lp.load("global");
      setMsg("Reset to defaults");
    } else if (layer === "workspace") {
      await lp.clear();
      await lp.load("workspace");
      setMsg("Cleared workspace perms");
    } else {
      await lp.clear();
      await lp.load("session");
      setMsg("Cleared session perms");
    }
  };

  const toggleCard = (name: string) => setOpenCards((o) => ({ ...o, [name]: !o[name] }));
  const toggleDesc = (name: string) => setOpenDesc((o) => ({ ...o, [name]: !o[name] }));
  const toggleInput = (name: string) => setOpenInput((o) => ({ ...o, [name]: !o[name] }));
  const toggleOutput = (name: string) => setOpenOutput((o) => ({ ...o, [name]: !o[name] }));
  const toggleSettings = (name: string) => setOpenSettings((o) => ({ ...o, [name]: !o[name] }));
  const toggleExt = (name: string) => setOpenExt((o) => ({ ...o, [name]: !o[name] }));

  if (!ready) {
    return <p className="text-sm text-zinc-500">Loading tools...</p>;
  }

  const isLayer = layer !== "global";

  return (
    <div className="min-h-0 flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-100">Tools</h2>
          <p className="text-xs text-zinc-500 mt-1">
            {tools.length} registered builtin tools.
          </p>
          {lp.path && (
            <p className="text-[10px] text-zinc-600 mt-1 font-mono break-all truncate">{lp.path}</p>
          )}
        </div>
        <select
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 shrink-0"
          value={layer}
          onChange={(e) => switchLayer(e.target.value as PermLayer)}
        >
          <option value="global">Global</option>
          {hasSession && <option value="workspace">Current workspace</option>}
          {hasSession && <option value="session">Current session</option>}
        </select>
      </div>

      {lp.error && <p className="text-xs text-red-400 mb-2">{lp.error}</p>}
      {msg && <p className="text-xs text-green-400 mb-2">{msg}</p>}

      <div className="flex-1 space-y-2">
        {tools.map((tool) => {
          const cardOpen = openCards[tool.name];
          const hasPerm = tool.name in lp.perms;
          const externalKey = EXTERNAL_DIRECTORY_PREFIX + tool.name;
          const extHasPerm = externalKey in lp.perms;
          return (
            <div key={tool.name} className="border border-zinc-800 rounded-md">
              <div
                className="flex items-center justify-between gap-2 p-3 cursor-pointer"
                onClick={() => toggleCard(tool.name)}
              >
                <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-200 font-medium">
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${
                      cardOpen ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  {tool.name}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <PermModeSelect
                    allowEmpty={isLayer}
                    emptyLabel="inherit"
                    value={isLayer && !hasPerm ? "" : (lp.perms[tool.name] ?? "ask")}
                    onChange={(mode) => {
                      if (isLayer && !mode) { void onInherit(tool.name); return; }
                      if (mode) void onChangePerm(tool.name, mode);
                    }}
                  />
                </div>
              </div>

              {cardOpen && (
                <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
                  <Collapsible
                    open={openDesc[tool.name]}
                    onToggle={() => toggleDesc(tool.name)}
                    label="Description"
                  >
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {tool.description}
                    </p>
                  </Collapsible>

                  {tool.inputFields.length > 0 && (
                    <Collapsible
                      open={openInput[tool.name]}
                      onToggle={() => toggleInput(tool.name)}
                      label="Input"
                    >
                      <div className="space-y-0.5">
                        {tool.inputFields.map((f) => (
                          <div key={f.name} className="flex items-start gap-2 text-xs">
                            <span className="font-mono text-zinc-300 shrink-0">{f.name}</span>
                            <span className="font-mono text-zinc-600 shrink-0">{f.type}</span>
                            {!f.required && <span className="text-zinc-700 shrink-0">?</span>}
                            {f.description && <span className="text-zinc-500 truncate">{f.description}</span>}
                          </div>
                        ))}
                      </div>
                    </Collapsible>
                  )}
                  {tool.outputFields.length > 0 && (
                    <Collapsible
                      open={openOutput[tool.name]}
                      onToggle={() => toggleOutput(tool.name)}
                      label="Output"
                    >
                      <div className="space-y-0.5">
                        {tool.outputFields.map((f) => (
                          <div key={f.name} className="flex items-start gap-2 text-xs">
                            <span className="font-mono text-zinc-300 shrink-0">{f.name}</span>
                            <span className="font-mono text-zinc-600 shrink-0">{f.type}</span>
                            {!f.required && <span className="text-zinc-700 shrink-0">?</span>}
                            {f.description && <span className="text-zinc-500 truncate">{f.description}</span>}
                          </div>
                        ))}
                      </div>
                    </Collapsible>
                  )}

                  <Collapsible
                    open={openExt[tool.name]}
                    onToggle={() => toggleExt(tool.name)}
                    label="External access"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-zinc-400">Allow outside workspace</span>
                      <div onClick={(e) => e.stopPropagation()}>
                        <PermModeSelect
                          allowEmpty={isLayer}
                          emptyLabel="inherit"
                          value={isLayer && !extHasPerm ? "" : (lp.perms[externalKey] ?? "ask")}
                          onChange={(mode) => {
                            if (isLayer && !mode) { void onInherit(externalKey); return; }
                            if (mode) void onChangePerm(externalKey, mode);
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      Unsandboxed file access for this tool. Ask = prompt each time.
                    </p>
                  </Collapsible>

                  {tool.name === "task" && (
                    <Collapsible
                      open={openSettings[tool.name]}
                      onToggle={() => toggleSettings(tool.name)}
                      label="Subagent Settings"
                    >
                      <SubagentSettingsCard />
                    </Collapsible>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-3 mt-3 border-t border-zinc-800">
        <button
          type="button"
          onClick={() => void onReset()}
          className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
        >
          {layer === "global" ? "Reset global perms" : `Clear ${LAYER_LABELS[layer].toLowerCase()} perms`}
        </button>
      </div>
    </div>
  );
}

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider hover:text-zinc-300"
      >
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        />
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
