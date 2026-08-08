import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { ToolConfig } from "../../../_shared/types";
import { registerToolsRoutes } from "./tools";

const READ_CONFIG: ToolConfig = {
  name: "read",
  description: "Read a file.",
  entry: "index.ts",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  enabled: true,
  permissionDefault: "allow",
};

describe("per-tool config/entry/skill REST", () => {
  let testDir: string;
  let dataDir: string;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-tools-config-api-"));
    dataDir = join(testDir, "data");
    const toolDir = join(dataDir, "tools", "builtin", "read");
    await mkdir(toolDir, { recursive: true });
    await writeFile(join(toolDir, "read.json"), JSON.stringify(READ_CONFIG, null, 2) + "\n", "utf-8");
    await writeFile(join(toolDir, "index.ts"), "export async function execute() { return 'ok'; }\n", "utf-8");
    await writeFile(join(toolDir, "skill.md"), "# Read\n\nUse read for files.\n", "utf-8");

    app = Fastify({ logger: false });
    registerToolsRoutes(app, dataDir);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it("GET /api/tools/:name/config returns the folder config", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tools/read/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; kind: string; config: ToolConfig };
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("builtin");
    expect(body.config.name).toBe("read");
    expect(body.config.permissionDefault).toBe("allow");
  });

  it("PUT /api/tools/:name/config writes a validated config", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tools/read/config",
      payload: { ...READ_CONFIG, description: "Updated description", permissionDefault: "ask" },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = JSON.parse(await readFile(join(dataDir, "tools", "builtin", "read", "read.json"), "utf-8")) as ToolConfig;
    expect(onDisk.description).toBe("Updated description");
    expect(onDisk.permissionDefault).toBe("ask");
    expect(onDisk.name).toBe("read");
  });

  it("PUT config rejects invalid configs", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tools/read/config",
      payload: { ...READ_CONFIG, permissionDefault: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET entry returns the entry file text", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tools/read/entry" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry: string; code: string };
    expect(body.entry).toBe("index.ts");
    expect(body.code).toContain("execute");
  });

  it("PUT entry writes the entry file", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tools/read/entry",
      payload: { code: "export async function execute() { return 'edited'; }\n" },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = await readFile(join(dataDir, "tools", "builtin", "read", "index.ts"), "utf-8");
    expect(onDisk).toContain("'edited'");
  });

  it("GET skill returns skill.md text", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tools/read/skill" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skill: string };
    expect(body.skill).toContain("# Read");
  });

  it("PUT skill writes skill.md", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tools/read/skill",
      payload: { skill: "# New Guide\n\nChanged.\n" },
    });
    expect(res.statusCode).toBe(200);
    const onDisk = await readFile(join(dataDir, "tools", "builtin", "read", "skill.md"), "utf-8");
    expect(onDisk).toBe("# New Guide\n\nChanged.\n");
  });

  it("GET config 404s for unknown tools and rejects unsafe names", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/tools/nope/config" });
    expect(missing.statusCode).toBe(404);
    const unsafe = await app.inject({ method: "GET", url: "/api/tools/..%2F..%2Fesc/config" });
    expect(unsafe.statusCode).toBe(400);
  });
});
