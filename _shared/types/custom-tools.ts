/**
 * A user-defined custom tool — stored as {dataDir}/custom-tools/{name}.json
 *
 * NOTE: Under the unified tools system this shape is being folded into
 * `ToolConfig` (see `_shared/types/config.ts`). Custom tools become
 * `ToolConfig` with an entry file, stored as `data/tools/custom/<name>/<name>.json`.
 * This interface is kept until the migration lands in a later task.
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
