import {
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type ClassDeclaration,
  type InterfaceDeclaration,
  type EnumDeclaration,
  type ModuleDeclaration,
  type TypeAliasDeclaration,
} from "ts-morph";
import type { SymbolKind, SymbolRow } from "../types";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  parentName: string | null;
  exported: boolean;
  async: boolean;
  static: boolean;
  visibility: "public" | "private" | "protected";
  signature: string | null;
  startLine: number;
  endLine: number;
  structuralHash: string;
}

export function extractSymbols(sourceFile: SourceFile): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  for (const stmt of sourceFile.getStatements()) {
    switch (stmt.getKind()) {
      case SyntaxKind.FunctionDeclaration: {
        const fn = stmt as FunctionDeclaration;
        const name = fn.getName();
        if (!name) continue;
        symbols.push({
          name,
          kind: "function",
          parentName: null,
          exported: fn.isExported() || fn.isDefaultExport(),
          async: fn.isAsync(),
          static: false,
          visibility: "public",
          signature: fn.getOverloads().length > 0
            ? fn.getOverloads()[0].getText().split("{")[0].trim()
            : fn.getText().split("{")[0].trim(),
          startLine: fn.getStartLineNumber(),
          endLine: fn.getEndLineNumber(),
          structuralHash: computeNodeHash(fn),
        });
        break;
      }

      case SyntaxKind.ClassDeclaration: {
        const cls = stmt as ClassDeclaration;
        const name = cls.getName();
        if (!name) continue;
        symbols.push({
          name,
          kind: "class",
          parentName: null,
          exported: cls.isExported() || cls.isDefaultExport(),
          async: false,
          static: false,
          visibility: "public",
          signature: null,
          startLine: cls.getStartLineNumber(),
          endLine: cls.getEndLineNumber(),
          structuralHash: computeNodeHash(cls),
        });

        for (const member of cls.getMembers()) {
          if (!("getName" in member) || typeof member.getName !== "function") continue;
          const mName = member.getName();
          if (!mName) continue;

          const memberKind: SymbolKind =
            member.getKind() === SyntaxKind.MethodDeclaration ||
            member.getKind() === SyntaxKind.PropertyDeclaration
              ? "method"
              : "method";

          symbols.push({
            name: mName,
            kind: memberKind,
            parentName: name,
            exported: false,
            async: typeof (member as any).isAsync === "function" ? (member as any).isAsync() : false,
            static: typeof (member as any).isStatic === "function" ? (member as any).isStatic() : false,
            visibility: "visibility" in member && typeof (member as any).getVisibility === "function"
            ? (member as any).getVisibility() : "public",
            signature: null,
            startLine: member.getStartLineNumber(),
            endLine: member.getEndLineNumber(),
            structuralHash: computeNodeHash(member),
          });
        }
        break;
      }

      case SyntaxKind.InterfaceDeclaration: {
        const iface = stmt as InterfaceDeclaration;
        const iname = iface.getName();
        if (!iname) continue;
        symbols.push({
          name: iname,
          kind: "interface",
          parentName: null,
          exported: iface.isExported() || iface.isDefaultExport(),
          async: false,
          static: false,
          visibility: "public",
          signature: null,
          startLine: iface.getStartLineNumber(),
          endLine: iface.getEndLineNumber(),
          structuralHash: computeNodeHash(iface),
        });
        break;
      }

      case SyntaxKind.EnumDeclaration: {
        const en = stmt as EnumDeclaration;
        const ename = en.getName();
        if (!ename) continue;
        symbols.push({
          name: ename,
          kind: "enum",
          parentName: null,
          exported: en.isExported() || en.isDefaultExport(),
          async: false,
          static: false,
          visibility: "public",
          signature: null,
          startLine: en.getStartLineNumber(),
          endLine: en.getEndLineNumber(),
          structuralHash: computeNodeHash(en),
        });
        break;
      }

      case SyntaxKind.ModuleDeclaration: {
        const mod = stmt as ModuleDeclaration;
        const mname = mod.getName();
        if (!mname) continue;
        symbols.push({
          name: mname,
          kind: "namespace",
          parentName: null,
          exported: mod.isExported() || mod.isDefaultExport(),
          async: false,
          static: false,
          visibility: "public",
          signature: null,
          startLine: mod.getStartLineNumber(),
          endLine: mod.getEndLineNumber(),
          structuralHash: computeNodeHash(mod),
        });
        break;
      }

      case SyntaxKind.TypeAliasDeclaration: {
        const typeAlias = stmt as TypeAliasDeclaration;
        const tname = typeAlias.getName();
        if (!tname) continue;
        symbols.push({
          name: tname,
          kind: "typeAlias",
          parentName: null,
          exported: typeAlias.isExported() || typeAlias.isDefaultExport(),
          async: false,
          static: false,
          visibility: "public",
          signature: null,
          startLine: typeAlias.getStartLineNumber(),
          endLine: typeAlias.getEndLineNumber(),
          structuralHash: computeNodeHash(typeAlias),
        });
        break;
      }

      case SyntaxKind.VariableStatement: {
        const varStmt = stmt as import("ts-morph").VariableStatement;
        for (const decl of varStmt.getDeclarations()) {
          const vname = decl.getName();
          if (!vname) continue;
          const isConst = varStmt.getDeclarationKind() === "const";
          symbols.push({
            name: vname,
            kind: isConst ? "constant" : "variable",
            parentName: null,
            exported: varStmt.isExported() || varStmt.isDefaultExport(),
            async: false,
            static: false,
            visibility: "public",
            signature: null,
            startLine: decl.getStartLineNumber(),
            endLine: decl.getEndLineNumber(),
            structuralHash: computeNodeHash(decl),
          });
        }
        break;
      }
    }
  }

  return symbols;
}

function getVisibility(node: { getModifiers?: () => any[] }): "public" | "private" | "protected" {
  if (!node.getModifiers) return "public";
  const mods = node.getModifiers();
  for (const m of mods) {
    const name = (m.getKindName?.() || "").toLowerCase();
    if (name.includes("private")) return "private";
    if (name.includes("protected")) return "protected";
  }
  return "public";
}

function computeNodeHash(node: { getKind: () => number; getKindName: () => string; getText: (includeTrivia?: boolean) => string }): string {
  const text = node.getText(false);
  const normalized = text
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}