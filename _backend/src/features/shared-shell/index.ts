export type { Shell, ShellStatus, ShellUpdate } from "./types";
export {
  createShell,
  writeToShell,
  resizeShell,
  closeShell,
  listShells,
  getShellOutput,
  closeAllShellsForSession,
  closeAllShells,
} from "./manager";
export { registerSharedShellRoutes } from "./rest";
