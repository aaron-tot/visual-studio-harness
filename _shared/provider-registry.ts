import type { ModelConfig } from "./types";

export type AuthType = "none" | "bearer";

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
  /** Predefined models this provider ships with.
   *  Non-test providers use a placeholder until live fetch replaces them. */
  defaultModels?: ModelConfig[];
}

const DEFAULT_MODEL_PLACEHOLDER: ModelConfig[] = [
  { displayName: "Default Model", modelName: "default" },
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
];

export function getDescriptorByDisplayName(name: string): ProviderDescriptor | undefined {
  return PRECONFIGURED_PROVIDERS.find((d) => d.name === name);
}
