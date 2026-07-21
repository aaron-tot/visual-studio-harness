import { useState, useEffect } from "react";
import { useConfigStore } from "../../stores/config";
import { Plus, Trash2, ToggleLeft, ToggleRight, Cast, Cable } from "lucide-react";
import { getMcpStatus } from "../../lib/api";
import type { McpServerConfig } from "../../../../_shared/types";

interface McpServersPanelProps {
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

interface ServerStatus {
  name: string;
  transport: string;
  connected: boolean;
  error?: string;
  toolCount: number;
}

export function McpServersPanel({ selectedIndex, onSelect }: McpServersPanelProps) {
  const { config, update } = useConfigStore();
  const [statuses, setStatuses] = useState<Map<string, ServerStatus>>(new Map());

  const servers = config.mcpServers ?? [];

  useEffect(() => {
    getMcpStatus()
      .then((data) => {
        const map = new Map<string, ServerStatus>();
        for (const s of data.servers) {
          map.set(s.name, s);
        }
        setStatuses(map);
      })
      .catch(() => {});
    const interval = setInterval(() => {
      getMcpStatus()
        .then((data) => {
          const map = new Map<string, ServerStatus>();
          for (const s of data.servers) {
            map.set(s.name, s);
          }
          setStatuses(map);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [servers.length]);

  const addServer = async () => {
    const newServer: McpServerConfig = {
      name: "",
      enabled: true,
      transport: "stdio",
    };
    const mcpServers = [...servers, newServer];
    const next = { ...config, mcpServers };
    useConfigStore.setState({ config: next });
    onSelect(mcpServers.length - 1);
    try {
      await update(next);
    } catch {}
  };

  const toggleServer = (index: number) => {
    const mcpServers = [...servers];
    mcpServers[index] = { ...mcpServers[index], enabled: !(mcpServers[index].enabled ?? true) };
    update({ ...config, mcpServers });
  };

  const removeServer = (index: number) => {
    const mcpServers = servers.filter((_, i) => i !== index);
    update({ ...config, mcpServers });
    if (selectedIndex === index) onSelect(-1);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">MCP Servers</h3>
        <button onClick={addServer} className="p-1 hover:bg-zinc-800 rounded" type="button">
          <Plus size={16} />
        </button>
      </div>
      <div className="space-y-1">
        {servers.map((server, i) => {
          const status = statuses.get(server.name);
          const connected = status?.connected ?? false;
          const enabled = server.enabled ?? true;
          const toolCount = status?.toolCount ?? 0;
          return (
            <div
              key={i}
              className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors ${
                selectedIndex === i
                  ? "bg-zinc-700"
                  : "hover:bg-zinc-800"
              } ${enabled ? "" : "opacity-50"}`}
              onClick={() => onSelect(i)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {connected ? (
                  <Cable size={14} className="text-green-400 shrink-0" />
                ) : (
                  <Cast size={14} className="text-zinc-600 shrink-0" />
                )}
                <span className={`text-sm truncate ${server.name ? "" : "text-zinc-500 italic"}`}>
                  {server.name || "Untitled server"}
                </span>
                {toolCount > 0 && (
                  <span className="text-xs text-zinc-500">{toolCount} tools</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleServer(i); }}
                  className={`p-0.5 rounded ${enabled ? "text-green-400" : "text-zinc-600"}`}
                  type="button"
                >
                  {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeServer(i); }}
                  className="p-1 hover:bg-zinc-600 rounded opacity-50 hover:opacity-100"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {servers.length === 0 && (
          <p className="text-xs text-zinc-500 py-4 text-center">
            No MCP servers configured. Click + to add one.
          </p>
        )}
      </div>
    </div>
  );
}
