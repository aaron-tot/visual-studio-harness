const encoder = new TextEncoder();

export function computeSourceHash(sourceText: string): string {
  const hashBuffer = crypto.subtle ? undefined : null;
  if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
    const buf = encoder.encode(sourceText);
    return Bun.hash(buf).toString(36);
  }
  let hash = 0;
  for (let i = 0; i < sourceText.length; i++) {
    const char = sourceText.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export async function computeFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return "";
  const content = await file.arrayBuffer();
  return Bun.hash(new Uint8Array(content)).toString(36);
}