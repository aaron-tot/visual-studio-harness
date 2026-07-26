export interface WorkspaceFsEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  path: string;
  timestampMs: number;
}

export function fsEventTypeFromRaw(rawType: string): WorkspaceFsEvent["type"] {
  switch (rawType) {
    case "change": return "change";
    case "add": return "add";
    case "unlink": return "unlink";
    case "addDir": return "addDir";
    case "unlinkDir": return "unlinkDir";
    default: return "change";
  }
}