import { z } from "zod";
import type { ToolDef, ToolFieldDef } from "../types";
import { SandboxError } from "../sandbox";
import { resolveAccessiblePath } from "../path-access";
import { runInPersistentBash } from "../host/pty-session";

const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,
  /\brm\s+-rf\s+\/\b/,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
];

export const bashTool: ToolDef = {
  name: "bash",
  description:
    "Run a shell command in a persistent bash session for this chat (cwd defaults to workspace; env persists across calls). Prefer non-interactive commands. Avoid full interactive TUIs.",
  permissionDefault: "ask",
  outputFields: [
    { name: "exitCode", type: "integer", description: "Command exit code (null if timed out)", required: false },
    { name: "cwd", type: "string", description: "Working directory the command ran in", required: true },
    { name: "command", type: "string", description: "The command that was run", required: false },
  ],
  inputSchema: z.object({
    command: z.string().describe("Shell command to run"),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(120_000)
      .optional()
      .describe("Timeout in ms (default 30000, max 120000)"),
    description: z
      .string()
      .optional()
      .describe("Short 5-10 word description for the UI"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory (relative, absolute, or ~/...; outside needs external_directory)"),
  }),
  execute: async (args, ctx) => {
    for (const re of DANGEROUS) {
      if (re.test(args.command)) {
        throw new SandboxError("ERROR bash: command blocked by safety policy");
      }
    }

    const cwd = args.cwd
      ? await resolveAccessiblePath(ctx, args.cwd)
      : ctx.workspaceRoot;

    const timeoutMs = args.timeout_ms ?? 30_000;
    const { output, exitCode } = await runInPersistentBash({
      sessionId: ctx.sessionId,
      cwd,
      command: args.command,
      timeoutMs,
      abortSignal: ctx.abortSignal,
    });

    const header = args.description ? `${args.description}\n` : "";
    return {
      title: args.description || "bash",
      output: `${header}exit=${exitCode ?? "?"}\n${output}`.trimEnd(),
      metadata: { exitCode, cwd },
      isError: exitCode !== 0 && exitCode !== null,
    };
  },
};
