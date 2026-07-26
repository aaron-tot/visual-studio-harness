import type { WorkspaceGraphService } from "./api/types";

let _service: WorkspaceGraphService | null = null;

export function setWorkspaceGraphService(service: WorkspaceGraphService | null): void {
  _service = service;
}

export function getWorkspaceGraphService(): WorkspaceGraphService | null {
  return _service;
}
