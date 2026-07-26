import { Project, ModuleKind, ModuleResolutionKind, ScriptTarget, type ProjectOptions } from "ts-morph";

let _project: Project | null = null;

export function getParserProject(): Project {
  if (!_project) {
    const options: ProjectOptions = {
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
    _project = new Project(options);
  }
  return _project;
}

export function resetParserProject(): void {
  _project = null;
}