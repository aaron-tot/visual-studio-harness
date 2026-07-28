import type { AgentSettings, WorkspaceManifestSettings } from "../../../../_shared/types";
import type { WorkspaceGraphService } from "../../../core/workspaceGraph/api/types";

export interface SectionContext {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  sessionId?: string;
  now?: Date;
  agentSettings?: AgentSettings;
  workspaceManifest?: WorkspaceManifestSettings;
  graphService?: WorkspaceGraphService;
  extras?: string[];
}