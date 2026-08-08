/**
 * Builtin `bash` tool — self-contained ctx entry.
 * Runs a shell command in a persistent bash session. Enforces the dangerous-
 * command safety policy, clamps the timeout via ctx.toolSettings?.bash, and
 * runs through ctx.runInPersistentBash (sessionId/abortSignal injected by ctx).
 */
const DANGEROUS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,
  /\brm\s+-rf\s+\/\b/,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
];

export async function execute(
  args: Record<string, unknown>,
  ctx: any
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}> {
  const command = String(args.command ?? "");

  for (const re of DANGEROUS) {
    if (re.test(command)) {
      throw new ctx.SandboxError("ERROR bash: command blocked by safety policy");
    }
  }

  const cwd = args.cwd ? await ctx.resolveAccessiblePath(String(args.cwd)) : ctx.workspaceRoot;

  const bashCfg = ctx.toolSettings?.bash ?? {};
  const min = bashCfg.timeoutMinMs ?? 100;
  const max = bashCfg.timeoutMaxMs ?? 300_000;
  const def = bashCfg.timeoutDefaultMs ?? 30_000;
  const timeoutMs = Math.max(min, Math.min(max, (args.timeout_ms as number) ?? def));

  const { output, exitCode } = await ctx.runInPersistentBash({
    cwd,
    command,
    timeoutMs,
  });

  const header = args.description ? `${args.description}\n` : "";
  return {
    title: (args.description as string) || "bash",
    output: `${header}exit=${exitCode ?? "?"}\n${output}`.trimEnd(),
    metadata: { exitCode, cwd },
    isError: exitCode !== 0 && exitCode !== null,
  };
}
