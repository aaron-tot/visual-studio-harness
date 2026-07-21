import { useState } from "react";
import { X } from "lucide-react";
import { ProviderList } from "../settings/ProviderList";
import { ProviderEditor } from "../settings/ProviderEditor";
import { ModelList } from "../settings/ModelList";
import { TemplateProviderEditor } from "../settings/TemplateProviderEditor";
import { AgentsPanel } from "../settings/AgentsPanel";
import { MdManager } from "../settings/MdManager";
import { ToolsPanel } from "../settings/ToolsPanel";
import { GeneralPanel } from "../settings/GeneralPanel";
import { SystemPromptPanel } from "../settings/SystemPromptPanel";
import { ShortcutsPanel } from "../settings/ShortcutsPanel";
import { TestModelsPanel } from "../settings/TestModelsPanel";
import { McpServersPanel } from "../settings/McpServersPanel";
import { McpServerEditor } from "../settings/McpServerEditor";
import { useConfigStore } from "../../stores/config";
import { PRECONFIGURED_PROVIDERS } from "../../../../_shared/provider-registry";

const TEMPLATE_NAMES = PRECONFIGURED_PROVIDERS.map((d) => d.name);

type Tab = "general" | "providers" | "mcp" | "agents" | "mds" | "tools" | "system" | "shortcuts" | "test-models";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  sessionId?: string;
}

export function SettingsModal({
  open,
  onClose,
  initialTab = "providers",
  sessionId,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [tabVersion, setTabVersion] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mcpSelectedIndex, setMcpSelectedIndex] = useState<number | null>(null);
  const { config } = useConfigStore();

  const selectedProvider = tab === "providers" && selectedIndex !== null ? config.providers[selectedIndex] : null;
  const isTemplate = selectedProvider
    ? TEMPLATE_NAMES.includes(selectedProvider.displayName)
    : false;

  if (!open) return null;

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setTab(id);
        setTabVersion((v) => v + 1);
      }}
      className={`px-3 py-1.5 text-xs rounded-md ${
        tab === id
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[10vh] z-50"
      onMouseDown={onClose}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-800 rounded-lg w-[900px] max-h-[85vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-zinc-800">
          {tabBtn("general", "General")}
          {tabBtn("providers", "Providers")}
          {tabBtn("mcp", "MCP")}
          {tabBtn("agents", "Agents")}
          {tabBtn("mds", "MD Files")}
          {tabBtn("tools", "Tools")}
          {tabBtn("system", "System Prompt")}
          {tabBtn("shortcuts", "Shortcuts")}
          {tabBtn("test-models", "Test Models")}
          <button
            onClick={onClose}
            className="ml-auto text-zinc-400 hover:text-zinc-200 p-1"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {tab === "general" && (
            <div key={`general-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <GeneralPanel />
            </div>
          )}

          {tab === "providers" && (
            <>
              <div className="w-64 border-r border-zinc-800 flex flex-col overflow-clip">
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  <ProviderList
                    onSelect={(i) => setSelectedIndex(i >= 0 ? i : null)}
                    selectedIndex={selectedIndex}
                  />
                </div>
              </div>
              <div className="flex-1 p-4 overflow-y-auto">
                {selectedIndex !== null ? (
                  isTemplate ? (
                    <TemplateProviderEditor providerIndex={selectedIndex} />
                  ) : (
                    <div className="space-y-6">
                      <ProviderEditor providerIndex={selectedIndex} />
                      <ModelList providerIndex={selectedIndex} />
                    </div>
                  )
                ) : (
                  <p className="text-sm text-zinc-500">Select a provider to edit</p>
                )}
              </div>
            </>
          )}

          {tab === "mcp" && (
            <>
              <div className="w-64 border-r border-zinc-800 flex flex-col overflow-clip">
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  <McpServersPanel
                    onSelect={(i) => setMcpSelectedIndex(i >= 0 ? i : null)}
                    selectedIndex={mcpSelectedIndex}
                  />
                </div>
              </div>
              <div className="flex-1 p-4 overflow-y-auto">
                {mcpSelectedIndex !== null ? (
                  <McpServerEditor serverIndex={mcpSelectedIndex} />
                ) : (
                  <p className="text-sm text-zinc-500">Select an MCP server to edit</p>
                )}
              </div>
            </>
          )}

          {tab === "agents" && (
            <div key={`agents-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <AgentsPanel />
            </div>
          )}

          {tab === "mds" && (
            <div key={`mds-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <MdManager sessionId={sessionId} />
            </div>
          )}

          {tab === "tools" && (
            <div key={`tools-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <ToolsPanel sessionId={sessionId || ""} />
            </div>
          )}

          {tab === "system" && (
            <div key={`system-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <SystemPromptPanel />
            </div>
          )}

          {tab === "shortcuts" && (
            <div key={`shortcuts-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <ShortcutsPanel />
            </div>
          )}

          {tab === "test-models" && (
            <div key={`test-models-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <TestModelsPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
