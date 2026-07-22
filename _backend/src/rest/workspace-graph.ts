import type { FastifyInstance } from "fastify";
import type { WorkspaceGraphService } from "../core/workspaceGraph/api/types";

export function registerWorkspaceGraphRoutes(
  app: FastifyInstance,
  getGraph: () => WorkspaceGraphService | null
) {
  app.get("/api/workspace-graph/symbols", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { name: string; kind?: string };
    return graph.query.findSymbol(q.name, q.kind);
  });

  app.get("/api/workspace-graph/functions", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { name: string };
    return graph.query.findFunction(q.name);
  });

  app.get("/api/workspace-graph/classes", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { name: string };
    return graph.query.findClass(q.name);
  });

  app.get("/api/workspace-graph/imports", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { filePath: string };
    return graph.query.listImports(q.filePath);
  });

  app.get("/api/workspace-graph/exports", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { filePath: string };
    return graph.query.listExports(q.filePath);
  });

  app.get("/api/workspace-graph/files", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { folderPath?: string };
    return graph.query.listFiles(q.folderPath);
  });

  app.get("/api/workspace-graph/folders", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { parentPath?: string };
    return graph.query.listFolders(q.parentPath);
  });

  app.get("/api/workspace-graph/manifest", async (request) => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { maxDepth?: string; includeFiles?: string };
    const manifest = await graph.manifest.workspaceManifest({
      maxDepth: q.maxDepth ? parseInt(q.maxDepth, 10) : undefined,
      includeFiles: q.includeFiles === "true",
    });
    return { manifest };
  });

  app.get("/api/workspace-graph/summary", async () => {
    const graph = getGraph();
    if (!graph) return { error: "Workspace graph not initialized" };
    return graph.query.workspaceSummary();
  });
}