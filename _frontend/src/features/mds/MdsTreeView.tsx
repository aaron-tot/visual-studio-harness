import { useCallback, useState } from "react";
import { FolderOpen, File, ChevronRight, ChevronDown, Pencil, Trash2, BookOpenText } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ScopeDirNode } from "../../lib/api";

const RESERVED_MDS_DIRS = new Set(["_skills", "_tools", "_SystemBase"]);

interface TreeNodeProps {
  node: ScopeDirNode;
  depth: number;
  relPath: string;
  onFolderContext: (e: React.MouseEvent, relPath: string, name: string, protectedDir: boolean) => void;
  onEditFile: (relPath: string, name: string, ext: string) => void;
  onDeleteFolder: (relPath: string, name: string) => void;
}

function TreeNode({ node, depth, relPath, onFolderContext, onEditFile, onDeleteFolder }: TreeNodeProps) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${depth * 16 + 10}px` };
  const protectedDir = node.type === "dir" && RESERVED_MDS_DIRS.has(relPath);
  const isPromptItem = node.type === "dir" && node.isItem === true;
  const isDropTarget = node.type === "dir" && !isPromptItem;

  const isFile = node.type !== "dir";
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({
    id: relPath,
    data: { relPath },
    disabled: isFile || protectedDir,
  });
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: relPath,
    data: { relPath },
    disabled: isFile || !isDropTarget,
  });

  const mergedRef = useCallback(
    (node: HTMLElement | null) => {
      dragRef(node);
      dropRef(node);
    },
    [dragRef, dropRef]
  );

  if (node.type === "dir") {
    return (
      <div className="group">
        <div
          ref={mergedRef}
          {...attributes}
          {...listeners}
          className={`flex items-center gap-1.5 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer select-none ${
            isOver ? "bg-zinc-700/50 ring-1 ring-sky-500/30 rounded" : ""
          }`}
          style={pad}
          onClick={() => setOpen((o) => !o)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFolderContext(e, relPath, node.name, protectedDir);
          }}
        >
          {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
          {isPromptItem ? (
            <BookOpenText size={12} className="shrink-0 text-sky-400/80" />
          ) : (
            <FolderOpen size={12} className="shrink-0 text-amber-500/70" />
          )}
          <span className="truncate font-mono text-[11px]">{node.name}/</span>
          {protectedDir && (
            <span className="ml-auto mr-1 shrink-0 text-[9px] uppercase tracking-wide text-zinc-600">locked</span>
          )}
          {!protectedDir && (
            <button
              type="button"
              title="Delete folder"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(relPath, node.name);
              }}
              className="ml-auto mr-1 shrink-0 p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {open && (
          <div>
            {node.children.map((c) => (
              <TreeNode
                key={c.name}
                node={c}
                depth={depth + 1}
                relPath={`${relPath}/${c.name}`}
                onFolderContext={onFolderContext}
                onEditFile={onEditFile}
                onDeleteFolder={onDeleteFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 py-1 text-zinc-400" style={pad}>
      <File size={12} className="shrink-0 text-zinc-600" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{node.name}</span>
      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
        {node.ext || "no ext"}
      </span>
      <button
        type="button"
        title="Edit file"
        onClick={() => onEditFile(relPath, node.name, node.ext)}
        className="mr-1 shrink-0 p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}

interface Props {
  tree: ScopeDirNode[];
  onRootContext: (e: React.MouseEvent) => void;
  onFolderContext: (e: React.MouseEvent, relPath: string, name: string, protectedDir: boolean) => void;
  onEditFile: (relPath: string, name: string, ext: string) => void;
  onDeleteFolder: (relPath: string, name: string) => void;
}

/** Render the MDS scope tree using @dnd-kit (useDraggable + useDroppable). */
export function MdsTreeView({ tree, onRootContext, onFolderContext, onEditFile, onDeleteFolder }: Props) {
  const { setNodeRef: rootDropRef, isOver: rootIsOver } = useDroppable({
    id: "__root__",
    data: { relPath: "" },
  });

  return (
    <div
      ref={rootDropRef}
      className={`rounded-md border py-1 ${
        rootIsOver ? "border-sky-500/50 bg-zinc-800/30" : "border-zinc-800/50 bg-zinc-900/30"
      }`}
      onContextMenu={onRootContext}
      title="Right-click to add a folder or MD"
    >
      {tree.length === 0 ? (
        <div className="px-2.5 py-1.5 text-[11px] italic text-zinc-600">
          empty — right-click to add a folder or MD
        </div>
      ) : (
        tree.map((n) => (
          <TreeNode
            key={n.name}
            node={n}
            depth={0}
            relPath={n.name}
            onFolderContext={onFolderContext}
            onEditFile={onEditFile}
            onDeleteFolder={onDeleteFolder}
          />
        ))
      )}
    </div>
  );
}
