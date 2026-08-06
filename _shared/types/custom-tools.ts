/**
 * A user-defined custom tool — stored as {dataDir}/custom-tools/{name}.json
 */
export interface CustomTool {
  /** Unique tool name (alphanumeric + hyphens, used as filename). */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** JavaScript function body. Receives (args, ctx) and returns string | { output, isError }. */
  code: string;
  /** When false, the tool is hidden from agents. */
  enabled: boolean;
  /** Default permission mode when first registered. */
  permissionDefault?: "allow" | "ask" | "deny";
  /** Optional skill guide markdown content for agent guidance. */
  skillGuide?: string;
  /** Skill push mode: "soft" = optional hint, "hard" = required read, "custom" = use custom text. */
  skillPushMode?: "soft" | "hard" | "custom";
  /** Skill ID for reading via skill tool (defaults to tool name). */
  skillId?: string;
  /** Custom push text when skillPushMode is "custom". */
  skillCustomPushText?: string;
}
