import type { WorkspaceGraphRepository } from "../storage/repository";
import type { ScannedFile } from "../types";
import type { ParsedFileGraph } from "../parser/parse-file";

export async function applyFileUpdate(
  repo: WorkspaceGraphRepository,
  file: ScannedFile,
  parsed: ParsedFileGraph
): Promise<number> {
  const fileId = await repo.upsertFile({
    path: file.path,
    filename: file.filename,
    extension: file.extension,
    language: file.language,
    size: file.size,
    modifiedMs: file.modifiedMs,
    fileHash: file.fileHash,
    indexedAtMs: Date.now(),
  });

  await repo.replaceFileSymbols(fileId, parsed.symbols);
  await repo.replaceFileImports(fileId, parsed.imports);
  await repo.replaceFileExports(fileId, parsed.exports);

  return fileId;
}
