export class WorkspaceGraphError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "WorkspaceGraphError";
  }
}

export class DatabaseError extends WorkspaceGraphError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, "DATABASE_ERROR");
    this.name = "DatabaseError";
  }
}

export class SchemaMigrationError extends WorkspaceGraphError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, "SCHEMA_MIGRATION_ERROR");
    this.name = "SchemaMigrationError";
  }
}

export class FileWatchError extends WorkspaceGraphError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, "FILE_WATCH_ERROR");
    this.name = "FileWatchError";
  }
}

export class ParseError extends WorkspaceGraphError {
  constructor(message: string, public readonly filePath: string, public readonly cause?: Error) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
  }
}

export class IndexingError extends WorkspaceGraphError {
  constructor(message: string, public readonly filePath: string, public readonly cause?: Error) {
    super(message, "INDEXING_ERROR");
    this.name = "IndexingError";
  }
}

export class NotInitializedError extends WorkspaceGraphError {
  constructor() {
    super("Workspace Graph not initialized. Call start() first.", "NOT_INITIALIZED");
    this.name = "NotInitializedError";
  }
}