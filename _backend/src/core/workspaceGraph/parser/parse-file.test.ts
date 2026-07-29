import { describe, expect, it, afterEach } from "bun:test";
import { getParserProject, resetParserProject } from "./project";
import { parseWorkspaceFile } from "./parse-file";
import { extractSymbols } from "./symbols";
import { extractImports, extractExports } from "./imports-exports";
import { computeStructuralHash } from "./structural-hash";

describe("parser", () => {
  afterEach(() => {
    resetParserProject();
  });

  describe("extractSymbols", () => {
    it("extracts functions, classes, interfaces, variables, enums, type aliases", () => {
      const project = getParserProject();
      const sf = project.createSourceFile("test.ts", `
        export function greet(name: string): string {
          return "hello " + name;
        }

        export class Greeter {
          private prefix: string;
          constructor(p: string) { this.prefix = p; }
          greet(name: string): string {
            return this.prefix + name;
          }
        }

        export interface Named {
          name: string;
        }

        export const VERSION = "1.0.0";

        let counter = 0;

        export enum Color {
          Red, Green, Blue
        }

        export type Predicate<T> = (x: T) => boolean;
      `, { overwrite: true });

      const symbols = extractSymbols(sf);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("Greeter");
      expect(names).toContain("greet"); // method
      expect(names).toContain("Named");
      expect(names).toContain("VERSION");
      expect(names).toContain("counter");
      expect(names).toContain("Color");
      expect(names).toContain("Predicate");

      const greet = symbols.find((s) => s.name === "greet");
      expect(greet?.kind).toBe("function");
      expect(greet?.exported).toBe(true);

      const greeter = symbols.find((s) => s.name === "Greeter");
      expect(greeter?.kind).toBe("class");

      const version = symbols.find((s) => s.name === "VERSION");
      expect(version?.kind).toBe("constant");

      const counterSym = symbols.find((s) => s.name === "counter");
      expect(counterSym?.kind).toBe("variable");
      expect(counterSym?.exported).toBe(false);
    });
  });

  describe("extractImports", () => {
    it("extracts named, default, namespace, and side-effect imports", () => {
      const project = getParserProject();
      const sf = project.createSourceFile("test-imports.ts", `
        import { join, resolve } from "node:path";
        import fs from "node:fs";
        import * as crypto from "node:crypto";
        import "reflect-metadata";
      `, { overwrite: true });

      const imports = extractImports(sf);

      expect(imports.length).toBe(4);

      const named = imports.find((i) => i.module === "node:path");
      expect(named?.importType).toBe("named");
      expect(named?.symbols).toEqual(["join", "resolve"]);

      const def = imports.find((i) => i.module === "node:fs");
      expect(def?.importType).toBe("default");
      expect(def?.symbols).toEqual(["fs"]);

      const ns = imports.find((i) => i.module === "node:crypto");
      expect(ns?.importType).toBe("namespace");

      const se = imports.find((i) => i.module === "reflect-metadata");
      expect(se?.importType).toBe("sideEffect");
    });
  });

  describe("extractExports", () => {
    it("extracts named and default exports", () => {
      const project = getParserProject();
      const sf = project.createSourceFile("test-exports.ts", `
        export function buildPlan() {}
        export default class DefaultClass {}
        export { buildPlan, something };
      `, { overwrite: true });

      const exports = extractExports(sf);

      expect(exports.some((e) => e.symbol === "buildPlan" && !e.isDefault)).toBe(true);
      expect(exports.some((e) => e.symbol === "DefaultClass" && e.isDefault)).toBe(true);
    });
  });

  describe("computeStructuralHash", () => {
    it("produces stable hash ignoring formatting-only changes", () => {
      const project = getParserProject();
      const sfA = project.createSourceFile("a.ts", `
        export function buildPlan() {
          return "plan";
        }
      `, { overwrite: true });
      const sfB = project.createSourceFile("b.ts", `
        export   function   buildPlan() {
          return  "plan";
        }
      `, { overwrite: true });

      const symA = extractSymbols(sfA);
      const symB = extractSymbols(sfB);

      const fnA = symA.find((s) => s.name === "buildPlan");
      const fnB = symB.find((s) => s.name === "buildPlan");

      expect(fnA?.structuralHash).toBe(fnB?.structuralHash);
    });
  });

  describe("parseWorkspaceFile", () => {
    it("extracts symbols, imports, exports, and stable structural hash", async () => {
      const result = await parseWorkspaceFile(
        {
          path: "src/build-plan.ts",
          filename: "build-plan.ts",
          extension: ".ts",
          language: "typescript",
          size: 100,
          modifiedMs: Date.now(),
          fileHash: "abc",
          sourceText: `
            import { join } from "node:path";
            import fs from "node:fs";

            export function buildPlan(input: string): string {
              return join(input, "plan");
            }

            export const VERSION = "1.0";
          `,
        },
        1
      );

      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.symbols.some((s) => s.name === "buildPlan")).toBe(true);
      expect(result.symbols.some((s) => s.name === "VERSION")).toBe(true);

      expect(result.imports.length).toBe(2);
      expect(result.imports.some((i) => i.module === "node:path")).toBe(true);
      expect(result.imports.some((i) => i.module === "node:fs")).toBe(true);

      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.exports.some((e) => e.symbol === "buildPlan")).toBe(true);
      expect(result.exports.some((e) => e.symbol === "VERSION")).toBe(true);
    });
  });
});
