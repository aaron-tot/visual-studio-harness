import { Project, ModuleKind, ModuleResolutionKind, ScriptTarget, IndentationText, type ProjectOptions } from "ts-morph";

let _project: Project | null = null;
let parserProjectConstructionCount = 0;

const DEFAULT_OPTIONS: ProjectOptions = {
  skipAddingFilesFromTsConfig: true,
  manipulationSettings: {
    indentationText: IndentationText.TwoSpaces,
  },
  compilerOptions: {
    allowJs: true,
    strictNullChecks: true,
    target: ScriptTarget.ESNext,
    module: ModuleKind.ESNext,
    moduleResolution: ModuleResolutionKind.Bundler,
    noEmit: true,
  },
};

/** Number of files parsed before the parser Project is dropped and recreated mid-reindex. */
export const REINDEX_PROJECT_RESET_INTERVAL = 250;

export function getParserProject(): Project {
  if (!_project) {
    _project = new Project(DEFAULT_OPTIONS);
    parserProjectConstructionCount++;
  }
  return _project;
}

export function resetParserProject(): void {
  _project = null;
}

export function resetParserProjectConstructionCount(): void {
  parserProjectConstructionCount = 0;
}

export function getParserProjectConstructionCount(): number {
  return parserProjectConstructionCount;
}
