import { Project } from "ts-morph";
import { getParserProject } from "./project";
import { extractSymbols } from "./symbols";
import { extractImports, extractExports } from "./imports-exports";
import type { ScannedFile } from "../types";
import type { SymbolRow, ImportRow, ExportRow } from "../types";

export interface ParsedFileGraph {
  symbols: SymbolRow[];
  imports: ImportRow[];
  exports: ExportRow[];
}

export async function parseWorkspaceFile(
  file: ScannedFile,
  fileId: number,
  project?: Project
): Promise<ParsedFileGraph> {
  const p = project ?? getParserProject();
  const sourceFile = p.createSourceFile(file.path, file.sourceText, {
    overwrite: true,
  });

  const extractedSymbols = extractSymbols(sourceFile);
  const extractedImports = extractImports(sourceFile);
  const extractedExports = extractExports(sourceFile);

  const symbols: SymbolRow[] = extractedSymbols.map((s) => ({
    name: s.name,
    kind: s.kind,
    parentId: null,
    fileId,
    exported: s.exported,
    async: s.async,
    static: s.static,
    visibility: s.visibility,
    signature: s.signature,
    startLine: s.startLine,
    endLine: s.endLine,
    structuralHash: s.structuralHash,
  }));

  const imports: ImportRow[] = extractedImports.map((i) => ({
    module: i.module,
    symbols: JSON.stringify(i.symbols),
    importType: i.importType,
    fileId,
  }));

  const exports: ExportRow[] = extractedExports.map((e) => ({
    symbol: e.symbol,
    isDefault: e.isDefault,
    fileId,
  }));

  p.removeSourceFile(sourceFile);

  return { symbols, imports, exports };
}