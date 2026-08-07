import type { AgentSettings, WorkspaceManifestSettings } from "../../../../_shared/types";
import type { WorkspaceGraphService } from "../../../core/workspaceGraph/api/types";

export interface SectionContext {
  dataDir: string;
  workspaceRoot: string;
  mode: string;
  sessionId?: string;
  now?: Date;
  turnStart?: Date;
  agentSettings?: AgentSettings;
  workspaceManifest?: WorkspaceManifestSettings;
  graphService?: WorkspaceGraphService;
  extras?: string[];
  /**
   * Which runtime parts to render (spec runtime split):
   * - `static` = workspace_root, mode, data_dir, os, session_id (base system prompt)
   * - `dynamic` = datetime, turn_elapsed (volatile tail)
   * Default (unset) = both, for backward compatibility.
   */
  runtimeInclude?: { static?: boolean; dynamic?: boolean };
}
