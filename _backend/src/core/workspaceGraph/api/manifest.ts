import type { WorkspaceGraphDb } from "../storage/db";
import { sql } from "drizzle-orm";
import type { ManifestOptions } from "./types";

export function createManifestApi(db: WorkspaceGraphDb) {
  const defaultOptions: ManifestOptions = {
    maxDepth: 4,
    excludeDirs: ["node_modules", ".git", "dist", "build", ".vsh", "coverage", ".turbo"],
    excludeExtensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff2", ".woff", ".eot", ".ttf"],
    includeFiles: true,
    includeHidden: false,
  };

  async function buildFolderTree(options: ManifestOptions): Promise<TreeNode> {
    const opts = { ...defaultOptions, ...options };
    const root: TreeNode = { name: ".", children: {} };

    const fileRows = await db
      .select({
        path: sql<string>`path`,
        filename: sql<string>`filename`,
        language: sql<string>`language`,
      })
      .from(sql`files`)
      .all();

    const skipDirs = new Set(opts.excludeDirs || []);
    const skipExts = new Set(opts.excludeExtensions || []);

    for (const row of fileRows as any[]) {
      const parts = row.path.split("/");
      const filename = parts[parts.length - 1];

      const ext = filename.lastIndexOf(".") > 0
        ? filename.slice(filename.lastIndexOf("."))
        : "";
      if (skipExts.has(ext)) continue;

      let node = root;
      let depth = 0;

      for (let i = 0; i < parts.length - 1; i++) {
        if (skipDirs.has(parts[i])) break;
        if (opts.maxDepth && depth >= opts.maxDepth) break;
        if (!node.children[parts[i]]) {
          node.children[parts[i]] = { name: parts[i], children: {} };
        }
        node = node.children[parts[i]];
        depth++;
      }

      if (opts.includeFiles && depth < (opts.maxDepth || 4)) {
        if (!node.children[filename]) {
          node.children[filename] = { name: filename, children: {} };
        }
      }
    }

    return root;
  }

  function treeToString(node: TreeNode, indent: string = "", isLast: boolean = true): string {
    const prefix = indent + (isLast ? "└── " : "├── ");
    let result = prefix + node.name + "\n";

    const entries = Object.values(node.children);
    const filtered = entries.filter(
      (c) => !c.name.startsWith(".") || c.name === ".gitignore"
    );

    for (let i = 0; i < filtered.length; i++) {
      const child = filtered[i];
      const childIsLast = i === filtered.length - 1;
      const nextIndent = indent + (isLast ? "    " : "│   ");
      result += treeToString(child, nextIndent, childIsLast);
    }

    return result;
  }

  return {
    async workspaceManifest(options?: ManifestOptions): Promise<string> {
      const tree = await buildFolderTree(options || {});
      return treeToString(tree);
    },

    async workspaceManifestFiles(options?: ManifestOptions): Promise<string> {
      const opts = { ...defaultOptions, ...options, includeFiles: true };
      const tree = await buildFolderTree(opts);
      return treeToString(tree);
    },

    async workspaceManifestFolders(options?: ManifestOptions): Promise<string> {
      const opts = { ...defaultOptions, ...options, includeFiles: false };
      const tree = await buildFolderTree(opts);
      return treeToString(tree);
    },

    async workspaceSummary(): Promise<string> {
      const counts = await db
        .select({
          files: sql<number>`COUNT(*)`,
          exts: sql<string>`GROUP_CONCAT(DISTINCT extension)`,
          langs: sql<string>`GROUP_CONCAT(DISTINCT language)`,
        })
        .from(sql`files`)
        .then((r: any) => r[0]);

      const symbolCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(sql`symbols`)
        .then((r: any) => r[0]?.count || 0);

      const extList = counts?.exts ? (counts.exts as string).split(",").filter(Boolean) : [];
      const langList = counts?.langs ? (counts.langs as string).split(",").filter(Boolean) : [];

      return [
        `Files: ${counts?.files || 0}`,
        `Symbols: ${symbolCount}`,
        `Extensions: ${extList.join(", ")}`,
        `Languages: ${langList.join(", ")}`,
      ].join("\n");
    },
  };
}

export type ManifestApi = ReturnType<typeof createManifestApi>;

interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
}
