/**
 * Builtin tool entry scaffold.
 * Self-contained on purpose: Task 4 re-authors this as a ctx-based entry that
 * uses the harness-provided `ctx` (same model as custom tools). Until then this
 * placeholder keeps the data-folder clone loadable without harness imports.
 */
export async function execute(
  _args: Record<string, unknown>,
  _ctx: Record<string, unknown>
): Promise<{ output: string; isError: boolean }> {
  return { output: "TODO: graph entry not yet re-authored", isError: true };
}
