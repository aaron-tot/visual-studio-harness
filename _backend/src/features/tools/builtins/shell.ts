/** Agent tool: share the session's interactive shells (shared-shell feature).
 *  Every action is scoped to the current conversation's session (`ctx.sessionId`)
 *  — the agent can only create/read/write/close shells that belong to its own
 *  session, never another session's terminals.
 */
import { z } from "zod";
import type { ToolDef, BaseToolContext, ToolResult } from "../types";
import {
  createShell,
  listShells,
  getShellForSession,
  getShellOutput,
  writeToShell,
  resizeShell,
  closeShell,
  closeAllShellsForSession,
} from "../../shared-shell/manager";
import type { ShellOutputOptions } from "../../shared-shell/manager";

const ShellActionSchema = z
  .object({
    action: z.enum([
      "create",
      "list",
      "listOutput",
      "sendText",
      "sendCommand",
      "readOutput",
      "resize",
      "close",
      "closeAll",
    ]),
    // create
    name: z.string().optional().describe("Shell name for create"),
    cwd: z.string().optional().describe("Working directory for create"),
    // targeting
    id: z
      .string()
      .optional()
      .describe(
        "The specific shell id to act on (required for sendText/sendCommand/readOutput/resize/close). Get it from list/listOutput.",
      ),
    // send
    text: z.string().optional().describe("Raw text to write (sendText)"),
    command: z.string().optional().describe("Command line to execute (sendCommand)"),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(120000)
      .optional()
      .describe("Reserved for future command-wait (default 30000)"),
    // read (readOutput/listOutput)
    limit: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 * 1024)
      .optional()
      .describe("Max chars to return; omit for the full buffer (readOutput/listOutput)"),
    tail: z
      .boolean()
      .optional()
      .describe("When limit set: true (default) returns the LAST limit chars, false the FIRST"),
    lines: z
      .number()
      .int()
      .min(0)
      .max(20000)
      .optional()
      .describe("Return only the last N lines of output, overriding char slicing"),
    // resize
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
  })
  .strict();

type ShellActionInput = z.infer<typeof ShellActionSchema>;

function ok(title: string, data: unknown): ToolResult {
  return { title, output: JSON.stringify(data, null, 2), metadata: data as Record<string, unknown> };
}

function err(shellId: string | undefined, message: string): ToolResult {
  const metadata = shellId ? { id: shellId } : undefined;
  return { title: "Shell Error", output: message, metadata, isError: true };
}

async function execute(args: ShellActionInput, ctx: BaseToolContext): Promise<ToolResult> {
  const sessionId = ctx.sessionId;

  // Resolve a shell id scoped to THIS session; throws if missing or foreign.
  const owned = (): string => {
    if (!args.id) throw new Error("id is required for this action");
    const shell = getShellForSession(sessionId, args.id);
    if (!shell) throw new Error(`Shell ${args.id} not found in this session`);
    return shell.id;
  };

  try {
    switch (args.action) {
      case "create": {
        const shell = await createShell({ sessionId, name: args.name, cwd: args.cwd });
        return ok("Shell Created", { shell });
      }

      case "list": {
        return ok("Shells", listShells(sessionId));
      }

      case "listOutput": {
        const readArgs: ShellOutputOptions = {};
        if (args.limit !== undefined) readArgs.limit = args.limit;
        if (args.tail !== undefined) readArgs.tail = args.tail;
        if (args.lines !== undefined) readArgs.lines = args.lines;
        const outputs: Record<string, string> = {};
        for (const shell of listShells(sessionId)) {
          outputs[shell.id] = await getShellOutput(shell.id, readArgs);
        }
        return ok("Shell Buffers", outputs);
      }

      case "sendText": {
        const id = owned();
        if (args.text === undefined) throw new Error("text is required for sendText");
        writeToShell(id, args.text);
        return ok("Text Sent", { id, sent: args.text.length });
      }

      case "sendCommand": {
        const id = owned();
        if (!args.command) throw new Error("command is required for sendCommand");
        writeToShell(id, args.command + "\n");
        return ok("Command Sent", { id, command: args.command });
      }

      case "readOutput": {
        const id = owned();
        return ok("Shell Output", {
          id,
          output: await getShellOutput(id, {
            limit: args.limit,
            tail: args.tail,
            lines: args.lines,
          }),
        });
      }

      case "resize": {
        const id = owned();
        if (!args.cols || !args.rows) throw new Error("cols and rows are required for resize");
        resizeShell(id, args.cols, args.rows);
        return ok("Shell Resized", { id, cols: args.cols, rows: args.rows });
      }

      case "close": {
        const id = owned();
        closeShell(id);
        return ok("Shell Closed", { id });
      }

      case "closeAll": {
        closeAllShellsForSession(sessionId);
        return ok("All Shells Closed", { closed: true });
      }
    }
  } catch (error) {
    return err(args.id, error instanceof Error ? error.message : String(error));
  }
}

export const shellTool: ToolDef = {
  name: "shell",
  description:
    "Manage interactive shells for THIS conversation's session. You may create MULTIPLE shells (one per task/concern) and act on any of them. Each shell is a real terminal shared with the user and rendered live in their GUI, so use them for anything the user should see happening. To act on a shell you MUST pass the specific shell id of the one you want: call `list` (or `listOutput`) first to get each shell's id, then pass that id to sendCommand/sendText/readOutput/resize/close. Actions: create, list, listOutput, sendText, sendCommand, readOutput, resize, close, closeAll. All actions are scoped to the current session only, and every per-shell action targets the shell whose id you pass.",
  permissionDefault: "allow",
  inputSchema: ShellActionSchema,
  execute,
};
