import { useEffect, useState } from "react";
import { FolderPlus, Pencil, FilePlus } from "lucide-react";
import { createMdsScopeFolder, createMdsScopeMd, renameMdsScopeFolder, deleteMdsScopeFolder, type ScopeDirNode } from "../../lib/api";
import type { PlanScope } from "../info-panel/types";
import { MdsNameModal } from "./MdsNameModal";
import { MdsEditModal } from "./MdsEditModal";
import { MdsConfirmModal } from "./MdsConfirmModal";
import { MdsTreeView } from "./MdsTreeView";

interface Props {
  scope: PlanScope;
  tree: ScopeDirNode[];
  sessionId?: string;
  workspaceRoot?: string;
  allTags: string[];
  onChanged: () => void;
}

interface MenuState {
  x: number;
  y: number;
  mode: "root" | "folder";
  relPath?: string;
  name?: string;
  protectedDir?: boolean;
}

type DialogState =
  | { kind: "mkdir"; parentRel?: string }
  | { kind: "mkmd"; parentRel?: string }
  | { kind: "rename"; from: string; currentName: string }
  | { kind: "edit"; relPath: string; name: string; ext: string }
  | { kind: "delete"; relPath: string; name: string };

/** Validate a single-segment name (no slashes, no traversal). Returns error message or null. */
function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required.";
  if (trimmed.includes("/") || trimmed.includes("\\")) return "Name cannot contain slashes.";
  if (trimmed === "." || trimmed === "..") return "Invalid name.";
  return null;
}

export function MdsScopeTree({ scope, tree, sessionId, workspaceRoot, allTags, onChanged }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const runCreateFolder = async (name: string, parentRel?: string) => {
    const err = validateName(name);
    if (err) throw new Error(err);
    const rel = parentRel ? `${parentRel}/${name.trim()}` : name.trim();
    await createMdsScopeFolder({ scope, name: rel, sessionId, workspaceRoot });
    onChanged();
  };

  const runCreateMd = async (name: string, parentRel?: string) => {
    const err = validateName(name);
    if (err) throw new Error(err);
    const rel = parentRel ? `${parentRel}/${name.trim()}` : name.trim();
    await createMdsScopeMd({ scope, name: rel, sessionId, workspaceRoot });
    onChanged();
  };

  const runRename = async (from: string, to: string) => {
    const err = validateName(to);
    if (err) throw new Error(err);
    if (to.trim() === from.split("/").pop()) return;
    await renameMdsScopeFolder({ scope, from, to: to.trim(), sessionId, workspaceRoot });
    onChanged();
  };

  const runDelete = async (relPath: string) => {
    await deleteMdsScopeFolder({ scope, path: relPath, sessionId, workspaceRoot });
    onChanged();
  };

  const onNewFolder = () => {
    const parent = menu?.mode === "folder" ? menu.relPath : undefined;
    setMenu(null);
    setDialog({ kind: "mkdir", parentRel: parent });
  };

  const onNewMd = () => {
    const parent = menu?.mode === "folder" ? menu.relPath : undefined;
    setMenu(null);
    setDialog({ kind: "mkmd", parentRel: parent });
  };

  const onRename = () => {
    if (!menu?.relPath) return;
    setMenu(null);
    setDialog({ kind: "rename", from: menu.relPath, currentName: menu.name || "" });
  };

  const onEditFile = (relPath: string, name: string, ext: string) => {
    setDialog({ kind: "edit", relPath, name, ext });
  };

  const onDeleteFolder = (relPath: string, name: string) => {
    setDialog({ kind: "delete", relPath, name });
  };

  return (
    <>
      <MdsTreeView
        tree={tree}
        onRootContext={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, mode: "root" });
        }}
        onFolderContext={(e, rel, name, protectedDir) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, mode: "folder", relPath: rel, name, protectedDir });
        }}
        onEditFile={onEditFile}
        onDeleteFolder={onDeleteFolder}
      />

      {menu && (
        <div
          className="fixed z-50 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {menu.mode === "root" ? (
            <>
              <MenuButton icon={<FolderPlus size={12} className="text-amber-500/70" />} label="New folder…" onClick={onNewFolder} />
              <MenuButton icon={<FilePlus size={12} className="text-sky-400/80" />} label="New MD…" onClick={onNewMd} />
            </>
          ) : (
            <>
              {!menu.protectedDir && (
                <MenuButton icon={<Pencil size={12} className="text-zinc-500" />} label={`Rename “${menu.name}”…`} onClick={onRename} />
              )}
              {menu.protectedDir && (
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-600">reserved folder</div>
              )}
              <MenuButton icon={<FolderPlus size={12} className="text-amber-500/70" />} label="New folder inside…" onClick={onNewFolder} />
              <MenuButton icon={<FilePlus size={12} className="text-sky-400/80" />} label="New MD inside…" onClick={onNewMd} />
            </>
          )}
        </div>
      )}

      {dialog?.kind === "mkdir" && (
        <MdsNameModal
          title={dialog.parentRel ? `New folder inside “${dialog.parentRel}”` : "New folder"}
          label="Folder name"
          confirmLabel="Create folder"
          placeholder="e.g. my-skill"
          onClose={() => setDialog(null)}
          onSubmit={(v) => runCreateFolder(v, dialog.parentRel)}
        />
      )}

      {dialog?.kind === "mkmd" && (
        <MdsNameModal
          title={dialog.parentRel ? `New MD inside “${dialog.parentRel}”` : "New MD"}
          label="MD name (folder + prompt.md / prompt.json)"
          confirmLabel="Create MD"
          placeholder="e.g. my-agent"
          onClose={() => setDialog(null)}
          onSubmit={(v) => runCreateMd(v, dialog.parentRel)}
        />
      )}

      {dialog?.kind === "rename" && (
        <MdsNameModal
          title={`Rename “${dialog.currentName}”`}
          label="New name"
          confirmLabel="Rename"
          initialValue={dialog.currentName}
          onClose={() => setDialog(null)}
          onSubmit={(v) => runRename(dialog.from, v)}
        />
      )}

      {dialog?.kind === "edit" && (
        <MdsEditModal
          scope={scope}
          relPath={dialog.relPath}
          ext={dialog.ext}
          sessionId={sessionId}
          workspaceRoot={workspaceRoot}
          allTags={allTags}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
        />
      )}

      {dialog?.kind === "delete" && (
        <MdsConfirmModal
          title={`Delete folder “${dialog.name}”`}
          message={`This permanently deletes the folder "${dialog.relPath}" and everything inside it (prompt.md, prompt.json, nested folders). This cannot be undone.`}
          confirmLabel="Delete folder"
          onClose={() => setDialog(null)}
          onConfirm={() => runDelete(dialog.relPath)}
        />
      )}
    </>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
