import type { SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

export interface ExtractedImport {
  module: string;
  symbols: string[];
  importType: "default" | "named" | "namespace" | "sideEffect";
}

export interface ExtractedExport {
  symbol: string;
  isDefault: boolean;
}

export function extractImports(sourceFile: SourceFile): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const module = imp.getModuleSpecifierValue();
    const namedImports = imp.getNamedImports();
    const defaultImport = imp.getDefaultImport()?.getText();
    const namespaceImport = imp.getNamespaceImport()?.getText();

    if (namedImports.length > 0) {
      imports.push({
        module,
        symbols: namedImports.map((n) => n.getName()),
        importType: "named",
      });
    } else if (defaultImport) {
      imports.push({
        module,
        symbols: [defaultImport],
        importType: "default",
      });
    } else if (namespaceImport) {
      imports.push({
        module,
        symbols: [namespaceImport],
        importType: "namespace",
      });
    } else {
      imports.push({
        module,
        symbols: [],
        importType: "sideEffect",
      });
    }
  }

  return imports;
}

export function extractExports(sourceFile: SourceFile): ExtractedExport[] {
  const exports: ExtractedExport[] = [];

  for (const stmt of sourceFile.getStatements()) {
    const kind = stmt.getKind();

    // export default expression
    if (kind === SyntaxKind.ExportAssignment) {
      const exportAssign = stmt as import("ts-morph").ExportAssignment;
      const expr = exportAssign.getExpression();
      exports.push({
        symbol: expr.getText(),
        isDefault: true,
      });
      continue;
    }

    // export { named1, named2 } or export { x as y }
    if (kind === SyntaxKind.ExportDeclaration) {
      const exportDecl = stmt as import("ts-morph").ExportDeclaration;
      const namedExports = exportDecl.getNamedExports();
      for (const ne of namedExports) {
        exports.push({
          symbol: ne.getName(),
          isDefault: false,
        });
      }
      continue;
    }

    // export function / class / interface / const / let / var
    const isExported = typeof (stmt as any).isExported === "function"
      ? (stmt as any).isExported()
      : false;
    if (!isExported) continue;

    // Named statements (FunctionDeclaration, ClassDeclaration, etc.)
    if (typeof (stmt as any).getName === "function") {
      const name = (stmt as any).getName() as string | undefined;
      if (name) {
        exports.push({
          symbol: name,
          isDefault: typeof (stmt as any).isDefaultExport === "function"
            ? (stmt as any).isDefaultExport()
            : false,
        });
        continue;
      }
    }

    // VariableStatement: export const x = 1, y = 2;
    if (kind === SyntaxKind.VariableStatement) {
      const varStmt = stmt as import("ts-morph").VariableStatement;
      for (const decl of varStmt.getDeclarations()) {
        const vname = decl.getName();
        if (vname) {
          exports.push({ symbol: vname, isDefault: false });
        }
      }
    }
  }

  return exports;
}
