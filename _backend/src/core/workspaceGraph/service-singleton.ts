import type { WorkspaceGraphManager } from "./graph-manager";

let _manager: WorkspaceGraphManager | null = null;

export function setWorkspaceGraphManager(manager: WorkspaceGraphManager | null): void {
  _manager = manager;
}

export function getWorkspaceGraphManager(): WorkspaceGraphManager | null {
  return _manager;
}
