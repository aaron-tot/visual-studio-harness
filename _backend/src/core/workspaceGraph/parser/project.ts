import { Project, ModuleKind, ModuleResolutionKind, ScriptTarget, type ProjectOptions } from "ts-morph";

let _project: Project | null = null;

const DEFAULT_OPTIONS: ProjectOptions = {
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
  manipulationSettings: {
    indentationText: " ",
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

export function getParserProject(): Project {
  if (!_project) {
    _project = new Project(DEFAULT_OPTIONS);
  }
  return _project;
}

/**
 * Create a fresh disposable Project instance.
 * Drops out of scope → GC can reclaim compiled ASTs, SymbolTable, and type checker caches.
 * Use for scoped operations like reindexWorkspace to prevent ~1.5 GB leak.
 */
export function createScopedProject(): Project {
  return new Project(DEFAULT_OPTIONS);
}

export function resetParserProject(): void {
  _project = null;
}
