/**
 * A user-defined custom tool — REST/UI wire shape (what `/api/custom-tools`
 * returns and accepts).
 *
 * Under the unified tools system the tool is STORED in the folder-per-tool
 * shape `{dataDir}/tools/custom/{name}/`:
 *   - `<name>.json`   — a `ToolConfig` (see `_shared/types/config.ts`) with
 *     `entry: "index.js"`. The code is NOT stored here.
 *   - `index.js`      — the tool's entry file (the `code` content, wrapped
 *     into an `execute` module). Loading/running happens via the folder store.
 *   - `skill.md`      — the skill guide (when present).
 *   - `prompt.json`   — skill tags (when present).
 *
 * The `code` field on this DTO is the entry file content; the custom-tools
 * store translates it to/from `index.js` on write/read.
 */
export interface CustomTool {
  /** Unique tool name (alphanumeric + hyphens, used as folder name). */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Entry file content (`index.js`). Receives (args, ctx) and returns string | { output, isError }. */
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
  /** Tags for the skill guide (stored in `prompt.json`). */
  skillTags?: string[];
}
