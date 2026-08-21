export type { Shell, ShellStatus, ShellUpdate } from "./types";
export {
  createShell,
  writeToShell,
  closeShell,
  listShells,
  getShellOutput,
  closeAllShellsForSession,
  closeAllShells,
} from "./manager";
export { registerSharedShellRoutes } from "./rest";
