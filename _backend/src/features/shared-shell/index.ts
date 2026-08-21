export type { Shell, ShellStatus, ShellUpdate } from "./types";
export {
  createShell,
  writeToShell,
  resizeShell,
  closeShell,
  listShells,
  getShellOutput,
  getShellForSession,
  closeAllShellsForSession,
  closeAllShells,
} from "./manager";
export { registerSharedShellRoutes } from "./rest";
