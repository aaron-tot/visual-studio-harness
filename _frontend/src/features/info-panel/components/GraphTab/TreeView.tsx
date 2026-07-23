import { useState, useEffect, useCallback } from "react";
import { getGraphManifest } from "../../../../lib/api";
import { EmptyState } from "../ui";

interface TreeNode {
  name: string;
  isDir: boolean;
  children: TreeNode[];
}

function parseManifestTree(text: string): TreeNode[] {
  const lines = text.split("\n");
  const root: TreeNode[] = [];
  const stack: { node: TreeNode; depth: number }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^([│├└─\s]+)(.+)$/);
    if (!match) {
      root.push({ name: line.trim(), isDir: line.endsWith("/"), children: [] });
      continue;
    }
    const indent = match[1].length;
    const name = match[2].replace(/\/$/, "");
    const isDir = match[2].endsWith("/");
    const node: TreeNode = { name, isDir, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].depth >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    if (isDir) stack.push({ node, depth: indent + 1 });
  }
  return root;
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const icon = node.isDir ? (open ? "📂" : "📁") : "📄";
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
      </div>
      {open && node.children.map((child, i) => (
        <TreeItem key={`${child.name}-${i}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function TreeView() {
  const [manifest, setManifest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyManifest = useCallback(() => {
    if (!manifest) return;
    navigator.clipboard.writeText(manifest);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [manifest]);

  useEffect(() => {
    getGraphManifest()
      .then((r) => { setManifest(r.manifest); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "Failed"); setLoading(false); });
  }, []);

  if (loading) return <EmptyState>Loading tree…</EmptyState>;
  if (error) return <EmptyState><span className="text-red-400">Error: {error}</span></EmptyState>;
  if (!manifest) return <EmptyState>No manifest data</EmptyState>;

  const tree = parseManifestTree(manifest);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800/50">
        <span className="text-[9px] text-zinc-600">Workspace tree</span>
        <button
          className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
            copied ? "bg-emerald-800/60 text-emerald-300" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          }`}
          onClick={copyManifest}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="px-1 py-1 font-mono">
        {tree.map((node, i) => (
          <TreeItem key={`${node.name}-${i}`} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}
