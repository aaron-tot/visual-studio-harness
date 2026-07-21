import { useState, useEffect, useCallback } from "react";
import { Loader2, Play, ChevronDown, ChevronRight } from "lucide-react";
import { useConfigStore } from "../../stores/config";
import { testMcpConnection, callMcpTool } from "../../lib/api";

interface McpServerEditorProps {
  serverIndex: number;
}

interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function McpServerEditor({ serverIndex }: McpServerEditorProps) {
  const { config, update } = useConfigStore();
  const server = config.mcpServers?.[serverIndex];

  const [name, setName] = useState(server?.name || "");
  const [transport, setTransport] = useState<"stdio" | "http" | "tcp">(server?.transport || "stdio");
  const [command, setCommand] = useState(server?.command || "");
  const [args, setArgs] = useState(server?.args?.join(" ") || "");
  const [url, setUrl] = useState(server?.url || "");
  const [headers, setHeaders] = useState(
    server?.headers ? JSON.stringify(server.headers, null, 2) : ""
  );
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [discoveredTools, setDiscoveredTools] = useState<DiscoveredTool[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [toolInputs, setToolInputs] = useState<Record<string, Record<string, string>>>({});
  const [toolRunning, setToolRunning] = useState<string | null>(null);
  const [toolResults, setToolResults] = useState<Record<string, string>>({});

  useEffect(() => {
    if (server) {
      setName(server.name);
      setTransport(server.transport);
      setCommand(server.command || "");
      setArgs(server.args?.join(" ") || "");
      setUrl(server.url || "");
      setHeaders(server.headers ? JSON.stringify(server.headers, null, 2) : "");
    }
  }, [server]);

  if (!server) return null;

  const buildServerConfig = () => ({
    name,
    transport,
    command: command || undefined,
    args: args.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    url: url || undefined,
    headers: (() => {
      try { const h = headers.trim(); return h ? JSON.parse(h) as Record<string, string> : undefined; }
      catch { return undefined; }
    })(),
  });

  const doSave = useCallback((changes: Partial<import("../../../../_shared/types").McpServerConfig>) => {
    const mcpServers = [...(useConfigStore.getState().config.mcpServers ?? [])];
    if (!mcpServers[serverIndex]) return;
    mcpServers[serverIndex] = { ...mcpServers[serverIndex], ...changes };
    const next = { ...useConfigStore.getState().config, mcpServers };
    useConfigStore.setState({ config: next });
    update(next).catch(() => {});
  }, [serverIndex, update]);

  const testConnection = async () => {
    setStatus("testing");
    setDiscoveredTools([]);
    try {
      const result = await testMcpConnection(buildServerConfig());
      setStatus(result.ok ? "success" : "error");
      if (result.ok && result.tools) {
        setDiscoveredTools(result.tools);
      }
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 3000);
  };

  const runTool = async (toolName: string) => {
    setToolRunning(toolName);
    try {
      const inputs = toolInputs[toolName] ?? {};
      const parsed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(inputs)) {
        if (val === "" || val === undefined) continue;
        if (val === "true") { parsed[key] = true; continue; }
        if (val === "false") { parsed[key] = false; continue; }
        const num = Number(val);
        parsed[key] = Number.isFinite(num) ? num : val;
      }
      const result = await callMcpTool(buildServerConfig(), toolName, parsed);
      setToolResults((prev) => ({
        ...prev,
        [toolName]: result.ok ? (result.result ?? "OK") : `Error: ${result.error}`,
      }));
    } catch (err) {
      setToolResults((prev) => ({
        ...prev,
        [toolName]: `Error: ${err}`,
      }));
    }
    setToolRunning(null);
  };

  const updateInput = (toolName: string, field: string, value: string) => {
    setToolInputs((prev) => ({
      ...prev,
      [toolName]: { ...(prev[toolName] ?? {}), [field]: value },
    }));
  };

  const changeTransport = (t: "stdio" | "http" | "tcp") => {
    setTransport(t);
    doSave({ transport: t });
  };

  const changeName = (v: string) => {
    setName(v);
    doSave({ name: v });
  };

  const changeCommand = (v: string) => {
    setCommand(v);
    doSave({ command: v || undefined });
  };

  const changeArgs = (v: string) => {
    setArgs(v);
    const parsed = v.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    doSave({ args: parsed.length > 0 ? parsed : undefined });
  };

  const changeUrl = (v: string) => {
    setUrl(v);
    doSave({ url: v || undefined });
  };

  const changeHeaders = (v: string) => {
    setHeaders(v);
    try {
      const h = v.trim();
      doSave({ headers: h ? JSON.parse(h) as Record<string, string> : undefined });
    } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Server Name</label>
        <input
          value={name}
          onChange={(e) => changeName(e.target.value)}
          placeholder="e.g. my-server"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Transport</label>
        <div className="flex gap-2">
          {(["stdio", "http", "tcp"] as const).map((t) => (
            <button
              key={t}
              onClick={() => changeTransport(t)}
              className={`px-3 py-1.5 text-xs rounded-md uppercase ${
                transport === t
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
              type="button"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {transport === "stdio" ? (
        <>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Command</label>
            <input value={command} onChange={(e) => changeCommand(e.target.value)} placeholder="e.g. npx" className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-mono" />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Arguments (space-separated)</label>
            <input value={args} onChange={(e) => changeArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /path" className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-mono" />
          </div>
        </>
      ) : transport === "tcp" ? (
        <div className="space-y-2">
          <label className="text-xs text-zinc-400">Host:Port</label>
          <input value={url} onChange={(e) => changeUrl(e.target.value)} placeholder="127.0.0.1:9876" className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-mono" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">URL</label>
            <input value={url} onChange={(e) => changeUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-mono" />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Headers (JSON, optional)</label>
            <textarea value={headers} onChange={(e) => changeHeaders(e.target.value)} rows={3} placeholder='{"x-api-key": "..."}' className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-mono resize-y" />
          </div>
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={testConnection}
          disabled={status === "testing"}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-all ${
            status === "success" ? "bg-green-600 text-white"
            : status === "error" ? "bg-red-600 text-white"
            : "bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
          }`}
          type="button"
        >
          {status === "testing" ? (
            <><Loader2 size={14} className="animate-spin" /> Testing...</>
          ) : status === "success" ? (
            <><Loader2 size={14} className="text-green-200" /> Connected ({discoveredTools.length} tools)</>
          ) : status === "error" ? (
            <><Loader2 size={14} className="text-red-200" /> Connection failed</>
          ) : (
            "Test Connection"
          )}
        </button>
      </div>

      {discoveredTools.length > 0 && (
        <div className="border-t border-zinc-800 pt-4 space-y-3">
          <h4 className="text-sm font-medium text-zinc-300">Discovered Tools ({discoveredTools.length})</h4>
          {discoveredTools.map((tool) => {
            const isExpanded = expandedTool === tool.name;
            const props = tool.inputSchema?.properties as Record<string, { type?: string; description?: string; enum?: string[]; properties?: Record<string, unknown> }> | undefined;
            const required = (tool.inputSchema?.required as string[]) ?? [];
            const inputs = toolInputs[tool.name] ?? {};
            const result = toolResults[tool.name];

            return (
              <div key={tool.name} className="bg-zinc-800/50 rounded border border-zinc-700/50">
                <div className="flex items-center justify-between px-3 py-2">
                  <button
                    onClick={() => setExpandedTool(isExpanded ? null : tool.name)}
                    className="flex items-center gap-2 flex-1 text-left"
                    type="button"
                  >
                    {isExpanded ? <ChevronDown size={14} className="text-zinc-400 shrink-0" /> : <ChevronRight size={14} className="text-zinc-400 shrink-0" />}
                    <div className="min-w-0">
                      <span className="text-sm text-zinc-200 font-mono">{tool.name}</span>
                      {tool.description && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{tool.description}</p>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => runTool(tool.name)}
                    disabled={toolRunning === tool.name}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-50 shrink-0"
                    type="button"
                  >
                    {toolRunning === tool.name ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Run
                  </button>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-zinc-700/50 space-y-3">
                    {props ? (
                      Object.entries(props).map(([fieldName, fieldSchema]: [string, any]) => (
                        <div key={fieldName} className="space-y-1">
                          <label className="text-xs text-zinc-400 flex items-center gap-1">
                            <span className="font-mono">{fieldName}</span>
                            {required.includes(fieldName) ? <span className="text-red-400">*</span> : <span className="text-zinc-600">(optional)</span>}
                            <span className="text-xs text-zinc-600">{fieldSchema.type || "any"}</span>
                          </label>
                          {fieldSchema.description && (
                            <p className="text-[11px] text-zinc-500 leading-tight">{fieldSchema.description}</p>
                          )}
                          {fieldSchema.enum ? (
                            <select
                              value={inputs[fieldName] ?? ""}
                              onChange={(e) => updateInput(tool.name, fieldName, e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                            >
                              <option value="">—</option>
                              {fieldSchema.enum.map((opt: string) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : fieldSchema.type === "boolean" ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={inputs[fieldName] === "true"}
                                onChange={(e) => updateInput(tool.name, fieldName, e.target.checked ? "true" : "false")}
                                className="rounded border-zinc-600 bg-zinc-800 text-blue-500"
                              />
                              <span className="text-xs text-zinc-500">{inputs[fieldName] === "true" ? "true" : "false"}</span>
                            </div>
                          ) : fieldSchema.type === "object" || fieldSchema.properties ? (
                            <textarea
                              value={inputs[fieldName] ?? ""}
                              onChange={(e) => updateInput(tool.name, fieldName, e.target.value)}
                              rows={3}
                              placeholder='{"key": "value"}'
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono resize-y"
                            />
                          ) : fieldSchema.type === "array" ? (
                            <textarea
                              value={inputs[fieldName] ?? ""}
                              onChange={(e) => updateInput(tool.name, fieldName, e.target.value)}
                              rows={2}
                              placeholder='["item1", "item2"]'
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono resize-y"
                            />
                          ) : (
                            <input
                              value={inputs[fieldName] ?? ""}
                              onChange={(e) => updateInput(tool.name, fieldName, e.target.value)}
                              placeholder={fieldSchema.type || "value"}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono"
                            />
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-500">No input parameters</p>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={() => runTool(tool.name)}
                        disabled={toolRunning === tool.name}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                        type="button"
                      >
                        {toolRunning === tool.name ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                        Execute
                      </button>
                    </div>

                    {result !== undefined && (
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-400">Output</label>
                        <pre className="w-full bg-black/40 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {result}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
