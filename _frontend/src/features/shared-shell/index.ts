import "./ws"; // side-effect: register shared-shell WS handlers
export type { Shell, ShellStatus } from "./types";
export { useSharedShellStore, initSharedShellWs } from "./store";
export { ShellList } from "./components/ShellList";
export { ShellTerminal } from "./components/ShellTerminal";
