import { useState, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { listWorkspaces, listFs } from "../lib/api";

export function useWorkspacePicker() {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot);
  const setWorkspaceRoot = useChatStore((s) => s.setWorkspaceRoot);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [fs, setFs] = useState<{ path?: string; parent?: string; entries?: { name: string; path: string; isDir: boolean }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fsPath, setFsPath] = useState("");

  const openPicker = useCallback(async () => {
    setOpen(true);
    setBrowsing(false);
    try {
      const r = await listWorkspaces();
      setRecent(r.workspaces || []);
    } catch {
      setRecent([]);
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setBrowsing(false);
  }, []);

  const apply = useCallback((path: string) => {
    setWorkspaceRoot(path);
    setOpen(false);
    setBrowsing(false);
  }, [setWorkspaceRoot]);

  const browse = useCallback(async (path?: string) => {
    setBrowsing(true);
    setLoading(true);
    try {
      const res = await listFs(path || workspaceRoot || undefined);
      setFs(res);
      setFsPath(res?.path || "");
    } catch {
      // ignore
    }
    setLoading(false);
  }, [workspaceRoot]);

  const goUp = useCallback(() => {
    if (fs?.parent) browse(fs.parent);
  }, [fs, browse]);

  return {
    workspaceRoot,
    open,
    recent,
    browsing,
    fs,
    loading,
    fsPath,
    openPicker,
    close,
    apply,
    browse,
    goUp,
    setFsPath,
  };
}
