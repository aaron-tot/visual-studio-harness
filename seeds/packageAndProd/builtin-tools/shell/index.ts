/**
 * Builtin `shell` tool — self-contained ctx entry.
 * Shares THIS session's interactive shells (shared-shell feature). Every action
 * is scoped to `ctx.sessionId`; shell ids are only usable when they belong to
 * the current session (enforced via ctx.services.sharedShell.findForSession).
 */
function result(title: string, data: unknown): { title: string; output: string; metadata?: Record<string, unknown> } {
  return { title, output: JSON.stringify(data, null, 2), metadata: data as Record<string, unknown> };
}

function errorResult(id: string | undefined, message: string): {
  title: string; output: string; metadata?: Record<string, unknown>; isError: boolean;
} {
  return { title: "Shell Error", output: message, metadata: id ? { id } : undefined, isError: true };
}

export async function execute(args: Record<string, unknown>, ctx: any): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const sessionId: string = ctx.sessionId;
  const ss = ctx.services.sharedShell;
  const action = String(args.action ?? "");

  // Resolve a shell id scoped to THIS session; throws if missing or foreign.
  const owned = (): string => {
    const id = args.id as string | undefined;
    if (!id) throw new Error("id is required for this action");
    const shell = ss.findForSession(sessionId, id);
    if (!shell) throw new Error(`Shell ${id} not found in this session`);
    return shell.id;
  };

  // Read options shared by readOutput/listOutput so the agent never has to
  // pull the whole transcript when it only wants a portion.
  const readOpts = (): Record<string, number | boolean> => {
    const opts: Record<string, number | boolean> = {};
    if (args.limit !== undefined) opts.limit = args.limit as number;
    if (args.tail !== undefined) opts.tail = args.tail as boolean;
    if (args.lines !== undefined) opts.lines = args.lines as number;
    return opts;
  };

  try {
    switch (action) {
      case "create": {
        const shell = await ss.create(sessionId, {
          name: args.name as string | undefined,
          cwd: args.cwd as string | undefined,
        });
        return result("Shell Created", { shell });
      }
      case "list":
        return result("Shells", ss.list(sessionId));
      case "listOutput": {
        const outputs: Record<string, string> = {};
        for (const shell of ss.list(sessionId)) {
          outputs[shell.id] = await ss.getOutput(shell.id, readOpts());
        }
        return result("Shell Buffers", outputs);
      }
      case "sendText": {
        const id = owned();
        const text = args.text as string | undefined;
        if (text === undefined) throw new Error("text is required for sendText");
        ss.write(id, text);
        return result("Text Sent", { id, sent: text.length });
      }
      case "sendCommand": {
        const id = owned();
        const command = args.command as string | undefined;
        if (!command) throw new Error("command is required for sendCommand");
        // Wait for the command to finish and return its captured output.
        const res = await ss.runCommand(id, command, {
          timeoutMs: (args.timeoutMs as number | undefined) ?? 30000,
        });
        return result("Command Output", {
          id,
          command,
          output: res.output,
          ...(res.timedOut ? { timedOut: true } : {}),
        });
      }
      case "readOutput": {
        const id = owned();
        return result("Shell Output", { id, output: await ss.getOutput(id, readOpts()) });
      }
      case "resize": {
        const id = owned();
        const cols = args.cols as number | undefined;
        const rows = args.rows as number | undefined;
        if (!cols || !rows) throw new Error("cols and rows are required for resize");
        ss.resize(id, cols, rows);
        return result("Shell Resized", { id, cols, rows });
      }
      case "close": {
        const id = owned();
        ss.close(id);
        return result("Shell Closed", { id });
      }
      case "closeAll":
        ss.closeAllForSession(sessionId);
        return result("All Shells Closed", { closed: true });
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    return errorResult(args.id as string | undefined, error instanceof Error ? error.message : String(error));
  }
}
