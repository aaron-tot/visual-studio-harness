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
  description: "Run a shell command in a persistent bash session (env persists across calls).",
  permissionDefault: "ask",
  outputFields: [
    { name: "exitCode", type: "integer", description: "Exit code (null if timed out)", required: false },
    { name: "cwd", type: "string", description: "Working directory the command ran in", required: true },
    { name: "command", type: "string", description: "Command that was run", required: false },
  ],
  inputSchema: z.object({
    command: z.string(),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Timeout in ms (default/config in settings)"),
    description: z
      .string()
      .optional()
      .describe("Short 5-10 word description for the UI"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory (defaults to workspace)"),
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

    const bashCfg = ctx.toolSettings?.bash ?? {};
    const min = bashCfg.timeoutMinMs ?? 100;
    const max = bashCfg.timeoutMaxMs ?? 300_000;
    const def = bashCfg.timeoutDefaultMs ?? 30_000;
    const timeoutMs = Math.max(min, Math.min(max, args.timeout_ms ?? def));
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
