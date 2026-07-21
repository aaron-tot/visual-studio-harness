import type { ConfigFile, SessionMeta } from "../../_shared/types";

export interface AppState {
  mode: "dev" | "prod";
  dataDir: string;
  config: ConfigFile;
}

export interface SessionEntry {
  meta: SessionMeta;
  path: string;
}
