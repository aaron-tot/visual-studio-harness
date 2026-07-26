import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  rootPath: text("root_path").primaryKey(),
  graphVersion: integer("graph_version").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
  indexedAtMs: integer("indexed_at_ms").notNull(),
});

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  parentId: integer("parent_id"),
}, (t) => ({
  parentIdx: index("idx_folders_parent_id").on(t.parentId),
}));

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  filename: text("filename").notNull(),
  extension: text("extension").notNull(),
  language: text("language").notNull(),
  size: integer("size").notNull(),
  modifiedMs: integer("modified_ms").notNull(),
  fileHash: text("file_hash").notNull(),
  indexedAtMs: integer("indexed_at_ms").notNull(),
}, (t) => ({
  extensionIdx: index("idx_files_extension").on(t.extension),
}));

export const symbols = sqliteTable("symbols", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  parentId: integer("parent_id"),
  fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  exported: integer("exported", { mode: "boolean" }).notNull(),
  async: integer("async", { mode: "boolean" }).notNull(),
  static: integer("static", { mode: "boolean" }).notNull(),
  visibility: text("visibility").notNull().default("public"),
  signature: text("signature"),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  structuralHash: text("structural_hash").notNull(),
}, (t) => ({
  nameIdx: index("idx_symbols_name").on(t.name),
  fileIdx: index("idx_symbols_file_id").on(t.fileId),
  kindIdx: index("idx_symbols_kind").on(t.kind),
  nameKindIdx: index("idx_symbols_name_kind").on(t.name, t.kind),
}));

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  module: text("module").notNull(),
  symbols: text("symbols").notNull(),
  importType: text("import_type").notNull(),
  fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
}, (t) => ({
  fileIdx: index("idx_imports_file_id").on(t.fileId),
  moduleIdx: index("idx_imports_module").on(t.module),
}));

export const exports_ = sqliteTable("exports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  fileId: integer("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
}, (t) => ({
  fileIdx: index("idx_exports_file_id").on(t.fileId),
  symbolIdx: index("idx_exports_symbol").on(t.symbol),
}));