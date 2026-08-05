import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTool } from "./edit";
import { applyPatchText } from "../host/patch";
import { SandboxError } from "../sandbox";

async function makeCtx(root: string): Promise<Record<string, unknown>> {
  return {
    dataDir: root,
    sessionId: "s",
    workspaceRoot: root,
    abortSignal: null,
    callId: "c",
    askPermission: async () => true,
    hookCtx: undefined,
    toolName: "edit",
  };
}

describe("edit fuzzy suggestion", () => {
  test("mismatched old_string returns a suggestion with line range + diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "function a() {\n  const x = 1;\n  return x;\n}\n");

      let err: SandboxError | null = null;
      try {
        await editTool.execute(
          {
            path: file,
            old_string: "function a() {\n    const x = 1;\n    return x;\n}",
            new_string: "function b() {}",
          },
          (await makeCtx(root)) as never
        );
      } catch (e) {
        err = e as SandboxError;
      }

      expect(err).not.toBeNull();
      expect(err!.message).toContain("Closest match at lines 1-4");
      expect(err!.message).toContain("const x = 1;");
      expect(err!.message).toContain("Re-issue the tool call");
      expect(err!.metadata).toMatchObject({
        suggestion: true,
        suggestionLines: 4,
      });
      expect((err!.metadata!.suggestionScore as number)).toBeGreaterThan(0.7);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("unrelated old_string keeps the legacy error (no suggestion)", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "import { z } from 'zod';\nexport const x = 1;\n");

      let err: SandboxError | null = null;
      try {
        await editTool.execute(
          { path: file, old_string: "const totally = 'unrelated';", new_string: "x" },
          (await makeCtx(root)) as never
        );
      } catch (e) {
        err = e as SandboxError;
      }

      expect(err).not.toBeNull();
      expect(err!.message).toContain("Include exact surrounding context");
      expect(err!.message).not.toContain("Closest match");
      expect(err!.metadata).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ambiguous match suppresses the suggestion", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "const x = 1;\nconst y = 2;\nconst x = 1;\nconst y = 2;\n");

      let err: SandboxError | null = null;
      try {
        await editTool.execute(
          { path: file, old_string: "  const x = 1;\n  const y = 2;", new_string: "z" },
          (await makeCtx(root)) as never
        );
      } catch (e) {
        err = e as SandboxError;
      }

      expect(err).not.toBeNull();
      expect(err!.message).toContain("Include exact surrounding context");
      expect(err!.message).not.toContain("Closest match");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("exact match still succeeds and writes the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "edit-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "const a = 1;\n");

      const res = await editTool.execute(
        { path: file, old_string: "const a = 1;", new_string: "const a = 2;" },
        (await makeCtx(root)) as never
      );

      expect(res.output).toBe("Edited sample.ts (1 replacement(s))");
      expect(await readFile(join(root, file), "utf-8")).toBe("const a = 2;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("apply_patch SEARCH suggestion", () => {
  test("unmatched SEARCH returns a suggestion", async () => {
    const root = await mkdtemp(join(tmpdir(), "patch-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "const a = 1;\nconst b = 2;\n");

      let err: SandboxError | null = null;
      try {
        await applyPatchText(
          root,
          `*** Update File: ${file}\n<<<<<<< SEARCH\nconst bee = 2;\n=======\nconst c = 3;\n>>>>>>> REPLACE\n`,
          async (p) => join(root, p)
        );
      } catch (e) {
        err = e as SandboxError;
      }

      expect(err).not.toBeNull();
      expect(err!.message).toContain("Closest match at lines 2-2");
      expect(err!.message).toContain("Re-issue");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("exact SEARCH still applies", async () => {
    const root = await mkdtemp(join(tmpdir(), "patch-fuzzy-"));
    try {
      const file = "sample.ts";
      await writeFile(join(root, file), "const a = 1;\nconst b = 2;\n");

      const res = await applyPatchText(
        root,
        `*** Update File: ${file}\n<<<<<<< SEARCH\nconst b = 2;\n=======\nconst c = 3;\n>>>>>>> REPLACE\n`,
        async (p) => join(root, p)
      );

      expect(res.touched).toEqual([file]);
      expect(await readFile(join(root, file), "utf-8")).toBe("const a = 1;\nconst c = 3;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
