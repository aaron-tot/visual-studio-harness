import { useState } from "react";
import { X } from "lucide-react";
import { ProviderList } from "../settings/ProviderList";
import { ProviderEditor } from "../settings/ProviderEditor";
import { ModelList } from "../settings/ModelList";
import { TemplateProviderEditor } from "../settings/TemplateProviderEditor";
import { AgentsPanel } from "../settings/AgentsPanel";
import { ToolsPanel } from "../settings/ToolsPanel";
import { GeneralPanel } from "../settings/GeneralPanel";
import { ShortcutsPanel } from "../settings/ShortcutsPanel";
import { TestModelsPanel } from "../settings/TestModelsPanel";
import { KnowledgeSettingsPanel } from "../settings/KnowledgeSettingsPanel";
import { SystemPromptPanel } from "../settings/SystemPromptPanel";
import { McpServersPanel } from "../settings/McpServersPanel";
import { McpServerEditor } from "../settings/McpServerEditor";
import { CustomToolsPanel } from "../settings/CustomToolsPanel";
import { SearchProvidersPanel } from "../settings/SearchProvidersPanel";
import { ContextPanel } from "../settings/ContextPanel";
import { useConfigStore } from "../../stores/config";
import { PRECONFIGURED_PROVIDERS } from "../../../../_shared/provider-registry";
import { ScopePicker } from "../../features/info-panel/components/ScopePicker";
import type { PlanScope } from "../../features/info-panel/types";
import { MdsScopePaths } from "../../features/mds/MdsScopePaths";

const TEMPLATE_NAMES = PRECONFIGURED_PROVIDERS.map((d) => d.name);

type Tab = "general" | "providers" | "agents" | "prompts" | "tools" | "context" | "knowledge" | "test-models";
type ToolsSubTab = "builtin" | "custom" | "mcp";
type PromptsSubTab = "mds" | "system";

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
  const [selectedMdsScope, setSelectedMdsScope] = useState<PlanScope>("global");
  const [toolsSubTab, setToolsSubTab] = useState<ToolsSubTab>("builtin");
  const [promptsSubTab, setPromptsSubTab] = useState<PromptsSubTab>("mds");

  const isDev = import.meta.env.DEV;

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

  const subTabBtn = <T extends string>(current: T, value: T, label: string, setter: (v: T) => void) => (
    <button
      type="button"
      onClick={() => setter(value)}
      className={`rounded px-2 py-1 text-xs ${
        current === value
          ? "bg-zinc-700 text-zinc-100"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
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
          {tabBtn("agents", "Agents")}
          {tabBtn("prompts", "Prompts & Skills")}
          {tabBtn("tools", "Tools")}
          {tabBtn("context", "Context")}
          {tabBtn("knowledge", "Knowledge")}
          {isDev && tabBtn("test-models", "Test Models")}
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
            <div key={`general-${tabVersion}`} className="flex-1 p-4 overflow-y-auto space-y-6">
              <GeneralPanel />
              <div className="border-t border-zinc-800 pt-4">
                <h3 className="text-sm font-medium text-zinc-300 mb-3">Keyboard Shortcuts</h3>
                <ShortcutsPanel />
              </div>
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

          {tab === "agents" && (
            <div key={`agents-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <AgentsPanel />
            </div>
          )}

          {tab === "prompts" && (
            <div key={`prompts-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <div className="flex gap-2 mb-4">
                {subTabBtn(promptsSubTab, "mds", "MDS", setPromptsSubTab)}
                {subTabBtn(promptsSubTab, "system", "System Prompt", setPromptsSubTab)}
              </div>
              {promptsSubTab === "mds" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium text-zinc-100">Scoped Prompt Files</h2>
                    <ScopePicker scope={selectedMdsScope} onChange={setSelectedMdsScope} />
                  </div>
                  <MdsScopePaths scope={selectedMdsScope} sessionId={sessionId} />
                </div>
              )}
              {promptsSubTab === "system" && <SystemPromptPanel />}
            </div>
          )}

          {tab === "tools" && (
            <div key={`tools-${tabVersion}`} className="flex-1 overflow-hidden flex flex-col">
              <div className="flex gap-2 px-4 pt-3 pb-2 border-b border-zinc-800">
                {subTabBtn(toolsSubTab, "builtin", "Builtin", setToolsSubTab)}
                {subTabBtn(toolsSubTab, "custom", "Custom", setToolsSubTab)}
                {subTabBtn(toolsSubTab, "mcp", "MCP", setToolsSubTab)}
              </div>
              {toolsSubTab === "builtin" && (
                <div className="flex-1 p-4 overflow-y-auto">
                  <ToolsPanel sessionId={sessionId || ""} />
                </div>
              )}
              {toolsSubTab === "custom" && (
                <div className="flex-1 overflow-y-auto">
                  <CustomToolsPanel sessionId={sessionId || ""} />
                </div>
              )}
              {toolsSubTab === "mcp" && (
                <div className="flex-1 flex overflow-hidden">
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
                </div>
              )}
            </div>
          )}

          {tab === "test-models" && (
            <div key={`test-models-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <TestModelsPanel />
            </div>
          )}

          {tab === "context" && (
            <div key={`context-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <ContextPanel sessionId={sessionId} />
            </div>
          )}

          {tab === "knowledge" && (
            <div key={`knowledge-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <KnowledgeSettingsPanel />
            </div>
          )}

          {tab === "search-providers" && (
            <div key={`search-providers-${tabVersion}`} className="flex-1 p-4 overflow-y-auto">
              <SearchProvidersPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
