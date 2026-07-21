export interface MdStats {
  chars: number;
  words: number;
  lines: number;
  tokens: number;
}

export interface MdMetaEntry {
  path: string;
  tags: string[];
  lastEdited: string | null;
  stats?: MdStats;
}

export interface MdMetaFile {
  entries: Record<string, MdMetaEntry[]>;
}
