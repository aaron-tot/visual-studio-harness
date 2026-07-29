import { describe, expect, it } from "bun:test";
import { createWorkspaceGraphService } from "./index";

describe("createWorkspaceGraphService", () => {
  it("creates a service with lifecycle and query handles", async () => {
    const service = await createWorkspaceGraphService({
      workspaceRoot: "/tmp/ws",
      enableWatcher: false,
    });

    expect(typeof service.start).toBe("function");
    expect(typeof service.stop).toBe("function");
    expect(typeof service.reindexAll).toBe("function");
    expect(typeof service.query.findSymbol).toBe("function");
    expect(typeof service.query.listFiles).toBe("function");
    expect(typeof service.query.listFolders).toBe("function");
    expect(typeof service.query.workspaceSummary).toBe("function");
    expect(typeof service.manifest.workspaceManifest).toBe("function");
    expect(typeof service.manifest.workspaceManifestFiles).toBe("function");
    expect(typeof service.manifest.workspaceManifestFolders).toBe("function");
    expect(typeof service.manifest.workspaceSummary).toBe("function");
  });

  it("start/stop toggles initialized state", async () => {
    const service = await createWorkspaceGraphService({
      workspaceRoot: "/tmp/ws2",
      enableWatcher: false,
    });

    await service.start();
    await service.stop();
    await service.start();
    await service.stop();
  });

  it("reindexAll throws when not started", async () => {
    const service = await createWorkspaceGraphService({
      workspaceRoot: "/tmp/ws3",
      enableWatcher: false,
    });

    await expect(service.reindexAll()).rejects.toThrow("not initialized");
  });

  it("getStatus returns idle state before start", async () => {
    const service = await createWorkspaceGraphService({
      workspaceRoot: "/tmp/ws4",
      enableWatcher: false,
    });

    const status = await service.getStatus();
    expect(status.state).toBe("idle");
    expect(status.fileCount).toBe(0);
    expect(status.folderCount).toBe(0);
    expect(status.symbolCount).toBe(0);
    expect(Array.isArray(status.languages)).toBe(true);
  });

  it("getStatus returns watching state after start", async () => {
    const service = await createWorkspaceGraphService({
      workspaceRoot: "/tmp/ws5",
      enableWatcher: false,
    });

    await service.start();
    const status = await service.getStatus();
    expect(status.state).toBe("watching");
    await service.stop();
  });
});
