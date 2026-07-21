import { extractLinks, isFilePath } from "./link-utils";

// NOTE: If path detection in remarkLinkPaths causes too many false positives or
// misses real paths, consider using react-linkify-it (supports custom regex for
// file paths) or link-harvester (classifies local vs external markdown links).
// No single lib handles URLs + file paths + folders, so a combo may be needed.

function splitTextWithLinks(text: string, links: { value: string; start: number; end: number }[]) {
  const nodes: any[] = [];
  let lastIndex = 0;

  for (const link of links) {
    if (link.start > lastIndex) {
      nodes.push({ type: "text", value: text.slice(lastIndex, link.start) });
    }
    nodes.push({
      type: "link",
      url: `file://${link.value}`,
      title: link.value,
      children: [{ type: "text", value: link.value }],
    });
    lastIndex = link.end;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", value: text.slice(lastIndex) });
  }

  return nodes;
}

function walk(tree: any) {
  if (!tree.children) return;

  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];

    if (child.type === "text") {
      const links = extractLinks(child.value);
      const fileLinks = links.filter((l) => l.type !== "url");
      if (fileLinks.length > 0) {
        const nodes = splitTextWithLinks(child.value, fileLinks);
        tree.children.splice(i, 1, ...nodes);
        i += nodes.length - 1;
      }
    }

    if (child.type === "inlineCode") {
      const path = child.value.trim();
      if (path.length > 1 && isFilePath(path)) {
        const isFolder = path.endsWith("/") || path.endsWith("\\");
        tree.children.splice(i, 1, {
          type: "link",
          url: `file://${path}`,
          title: path,
          data: { hProperties: { "data-link-type": isFolder ? "folder" : "file" } },
          children: [
            {
              type: "inlineCode",
              value: path,
            },
          ],
        });
      }
    }

    if (child.children) {
      walk(child);
    }
  }
}

export function remarkLinkPaths() {
  return walk;
}
