export function isIgnored(
  relativePath: string,
  excludeDirs: string[]
): boolean {
  const parts = relativePath.split("/");
  for (const dir of excludeDirs) {
    if (parts.includes(dir)) return true;
  }
  const filename = parts[parts.length - 1];
  if (filename.startsWith(".") && filename !== ".gitignore") return true;
  return false;
}

export function isSourceFile(filename: string, includeExtensions: string[]): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = filename.slice(dot);
  return includeExtensions.includes(ext);
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

export function getLanguage(extension: string): string {
  return EXT_TO_LANG[extension] || "unknown";
}
