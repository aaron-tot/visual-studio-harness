import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WorkspaceGraphManager } from "../core/workspaceGraph/graph-manager";

export function registerWorkspaceGraphRoutes(
  app: FastifyInstance,
  getManager: () => WorkspaceGraphManager | null
) {
  function getGraph(request: FastifyRequest) {
    const manager = getManager();
    if (!manager) return null;
    const workspaceRoot = (request.query as { workspaceRoot?: string }).workspaceRoot;
    if (workspaceRoot) return manager.get(workspaceRoot);
    return manager.getFirstWorkspace();
  }

  app.get("/api/workspace-graph/symbols", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized. Pass workspaceRoot query param." };
    const q = request.query as { name?: string; kind?: string; workspaceRoot?: string };
    return graph.query.findSymbol(q.name ?? "", q.kind as Parameters<typeof graph.query.findSymbol>[1]);
  });

  app.get("/api/workspace-graph/functions", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { name: string; workspaceRoot?: string };
    return graph.query.findFunction(q.name);
  });

  app.get("/api/workspace-graph/classes", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { name: string; workspaceRoot?: string };
    return graph.query.findClass(q.name);
  });

  app.get("/api/workspace-graph/imports", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { filePath: string; workspaceRoot?: string };
    return graph.query.listImports(q.filePath);
  });

  app.get("/api/workspace-graph/exports", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { filePath: string; workspaceRoot?: string };
    return graph.query.listExports(q.filePath);
  });

  app.get("/api/workspace-graph/files", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { folderPath?: string; workspaceRoot?: string };
    return graph.query.listFiles(q.folderPath);
  });

  app.get("/api/workspace-graph/folders", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { parentPath?: string; workspaceRoot?: string };
    return graph.query.listFolders(q.parentPath);
  });

  app.get("/api/workspace-graph/manifest", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    const q = request.query as { maxDepth?: string; includeFiles?: string; workspaceRoot?: string };
    const manifest = await graph.manifest.workspaceManifest({
      maxDepth: q.maxDepth ? parseInt(q.maxDepth, 10) : undefined,
      includeFiles: q.includeFiles === "true",
    });
    return { manifest };
  });

  app.get("/api/workspace-graph/summary", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    return graph.query.workspaceSummary();
  });

  app.get("/api/workspace-graph/status", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { state: "idle", fileCount: 0, folderCount: 0, symbolCount: 0, languages: [], lastIndexedAt: 0, dbPath: "", note: "Pass workspaceRoot query param" };
    return graph.getStatus();
  });

  app.post("/api/workspace-graph/reindex", async (request) => {
    const graph = getGraph(request);
    if (!graph) return { error: "Workspace graph not initialized" };
    await graph.reindexAll();
    return { ok: true };
  });
}
