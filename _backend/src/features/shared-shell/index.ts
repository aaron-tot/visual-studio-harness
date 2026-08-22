export type { Shell, ShellStatus, ShellUpdate, ShellSnapshot } from "./types";
export {
  createShell,
  writeToShell,
  resizeShell,
  closeShell,
  listShells,
  getShellOutput,
  setShellSnapshot,
  getShellSnapshot,
  getShellForSession,
  closeAllShellsForSession,
  closeAllShells,
} from "./manager";
export { registerSharedShellRoutes } from "./rest";
