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
}
