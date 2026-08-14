/**
 * Build-time identity for the update indicator.
 *
 * BUILD_COMMIT is the exact Git SHA the running binary was built from. In prod
 * it is baked in at compile time by scripts/build-prod.ts (a Bun `--define`
 * replaces `process.env.VSH_BUILD_COMMIT`). In dev it stays empty and the
 * update check is disabled (prod-only feature).
 */
export const BUILD_COMMIT: string = process.env.VSH_BUILD_COMMIT ?? "";
