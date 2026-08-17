import type { ModelConfig } from "./types";

export type AuthType = "none" | "bearer" | "oauth";

export interface FieldDescriptor {
  key: string;
  label: string;
  type: "password" | "text" | "number";
  required: boolean;
  placeholder?: string;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  icon: string;
  baseUrl: string;
  authType: AuthType;
  extraFields?: FieldDescriptor[];
  capabilities?: { thinking?: boolean };
  editorComponent?: string;
  /** Provider supports OpenRouter-style per-model routing (provider.order / allow_fallbacks). */
  supportsProviderRouting?: boolean;
  /** Predefined models this provider ships with.
   *  Non-test providers use a placeholder until live fetch replaces them. */
  defaultModels?: ModelConfig[];
}

const DEFAULT_MODEL_PLACEHOLDER: ModelConfig[] = [
  { displayName: "Default Model", modelName: "default" },
];

/** Default Grok models offered by the xAI API. Placeholders until live fetch replaces them. */
const XAI_MODELS: ModelConfig[] = [
  { displayName: "Grok 4", modelName: "grok-4" },
  { displayName: "Grok 4 Fast", modelName: "grok-4-fast" },
  { displayName: "Grok 3", modelName: "grok-3" },
  { displayName: "Grok 3 Mini", modelName: "grok-3-mini" },
];

const TEST_MODELS: ModelConfig[] = [
  { displayName: "test", modelName: "test" },
  { displayName: "model1000", modelName: "model1000" },
  { displayName: "model-mixed", modelName: "model-mixed" },
  { displayName: "model-alltools", modelName: "model-alltools" },
  { displayName: "toolsV2", modelName: "toolsV2" },
  { displayName: "model-slow", modelName: "model-slow" },
  { displayName: "model5000", modelName: "model5000" },
];

export const PRECONFIGURED_PROVIDERS: ProviderDescriptor[] = [
  {
    id: "test",
    name: "Test",
    icon: "🧪",
    baseUrl: "http://localhost:1/test",
    authType: "none",
    editorComponent: "test",
    defaultModels: TEST_MODELS,
  },
  {
    id: "ollama",
    name: "Ollama",
    icon: "🦙",
    baseUrl: "http://localhost:11434/v1",
    authType: "none",
    editorComponent: "ollama",
    defaultModels: DEFAULT_MODEL_PLACEHOLDER,
  },
  {
    id: "zen",
    name: "OpenCode Zen",
    icon: "✨",
    baseUrl: "https://opencode.ai/zen/v1",
    authType: "bearer",
    extraFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Enter your API key..." },
    ],
    defaultModels: DEFAULT_MODEL_PLACEHOLDER,
  },
  {
    id: "go",
    name: "OpenCode Go",
    icon: "🚀",
    baseUrl: "https://opencode.ai/zen/go/v1",
    authType: "bearer",
    extraFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Enter your API key..." },
    ],
    defaultModels: DEFAULT_MODEL_PLACEHOLDER,
  },
  {
    id: "llama.cpp-swap",
    name: "llama.cpp-swap",
    icon: "🦙",
    baseUrl: "http://localhost:8080/v1",
    authType: "none",
    capabilities: { thinking: false },
    defaultModels: DEFAULT_MODEL_PLACEHOLDER,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: "🛰️",
    baseUrl: "https://openrouter.ai/api/v1",
    authType: "bearer",
    extraFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Enter your OpenRouter API key (sk-or-...)" },
    ],
    capabilities: { thinking: true },
    supportsProviderRouting: true,
    defaultModels: DEFAULT_MODEL_PLACEHOLDER,
  },
  {
    id: "xai",
    name: "Grok",
    icon: "𝕏",
    baseUrl: "https://api.x.ai/v1",
    authType: "oauth",
    extraFields: [
      { key: "apiKey", label: "API Key (optional)", type: "password", required: false, placeholder: "Optional xAI API key (sk-/xai-...)" },
    ],
    editorComponent: "xai",
    capabilities: { thinking: true },
    defaultModels: XAI_MODELS,
  },
];

export function getDescriptorByDisplayName(name: string): ProviderDescriptor | undefined {
  return PRECONFIGURED_PROVIDERS.find((d) => d.name === name);
}

/** Per-model provider routing availability. Preconfigured providers opt in
 *  (OpenRouter); unknown/custom providers default to true since they may be
 *  OpenRouter-compatible endpoints. */
export function supportsProviderRouting(displayName: string): boolean {
  const desc = getDescriptorByDisplayName(displayName);
  return desc ? (desc.supportsProviderRouting ?? false) : true;
}
