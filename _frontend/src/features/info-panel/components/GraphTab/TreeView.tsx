import { useState, useEffect, useCallback, useMemo } from "react";
import { getGraphManifest } from "../../../../lib/api";
import { EmptyState } from "../ui";
import { ViewToggle, RawPanel } from "./view-toggle";
import type { ViewMode } from "./view-toggle";

interface TreeNode {
  name: string;
  isDir: boolean;
  children: TreeNode[];
}

function parseManifestTree(text: string): TreeNode[] {
  const lines = text.split("\n");
  const entries: { name: string; indent: number }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^([│├└─\s]+)(.+)$/);
    if (!match) continue;
    entries.push({ name: match[2], indent: match[1].length });
  }

  if (entries.length === 0) return [];

  const nodes: TreeNode[] = entries.map((e) => ({ name: e.name, isDir: false, children: [] }));
  const hasRoot = nodes[0].name === ".";
  const rootIndent = hasRoot ? entries[0].indent : -1;
  const stack: { idx: number; indent: number }[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const indent = entries[i].indent;

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (hasRoot && top.idx === 0) break;
      if (top.indent >= indent) stack.pop();
      else break;
    }

    if (stack.length > 0) {
      nodes[stack[stack.length - 1].idx].children.push(nodes[i]);
    }
    stack.push({ idx: i, indent });
  }

  if (hasRoot) {
    const markDirs = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        n.isDir = n.children.length > 0;
        if (n.isDir) markDirs(n.children);
      }
    };
    markDirs(nodes[0].children);
    return nodes[0].children;
  }

  const markDirs = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      n.isDir = n.children.length > 0;
      if (n.isDir) markDirs(n.children);
    }
  };
  markDirs(nodes);
  return nodes;
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const icon = node.isDir ? (open ? "\u{1F4C2}" : "\u{1F4C1}") : "\u{1F4C4}";
  return (
    <>
      <div
        className="flex items-center gap-1 px-1 py-0.5 hover:bg-zinc-800/50 rounded cursor-default"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => node.isDir && setOpen(!open)}
      >
        <span className="text-[10px]">{icon}</span>
        <span className={`text-[11px] font-mono ${node.isDir ? "text-zinc-300" : "text-zinc-400"}`}>
          {node.name}{node.isDir ? "/" : ""}
        </span>
        {node.children.length > 0 && (
          <span className="text-[8px] text-zinc-600 ml-auto">{node.children.length}</span>
        )}
      </div>
      {open && node.children.map((child, i) => (
        <TreeItem key={`${child.name}-${i}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function TreeStats({ tree }: { tree: TreeNode[] }) {
  let dirs = 0;
  let files = 0;
  const count = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.isDir) { dirs++; count(n.children); } else { files++; }
    }
  };
  count(tree);
  return (
    <span className="text-[9px] text-zinc-600">{dirs} dirs, {files} files</span>
  );
}

export function TreeView() {
  const [manifest, setManifest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("pretty");

  useEffect(() => {
    getGraphManifest()
      .then((r) => { setManifest(r.manifest); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed"); setLoading(false); });
  }, []);

  const tree = useMemo(() => manifest ? parseManifestTree(manifest) : [], [manifest]);


  if (loading) return <EmptyState>Loading tree…</EmptyState>;
  if (error) return <EmptyState><span className="text-red-400">Error: {error}</span></EmptyState>;
  if (!manifest) return <EmptyState>No manifest data</EmptyState>;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ViewToggle mode={viewMode} onChange={setViewMode} />
      {viewMode === "pretty" ? (
        <>
          <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800/50">
            <TreeStats tree={tree} />
          </div>
          <div className="flex-1 overflow-y-auto px-1 py-1 font-mono">
            {tree.map((node, i) => (
              <TreeItem key={`${node.name}-${i}`} node={node} depth={0} />
            ))}
          </div>
        </>
      ) : (
        <RawPanel text={manifest} />
      )}
    </div>
  );
}
