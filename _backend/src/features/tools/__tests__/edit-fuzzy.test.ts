import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTool } from "../builtins/edit";
import { SandboxError } from "../sandbox";
import { ToolExecutor } from "../executor";

describe("edit tool fuzzy-match suggestions", () => {
  let testDir: string;
  let executor: ToolExecutor;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "vsh-edit-test-"));
    executor = new ToolExecutor();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makeCtx(path: string, callId = "test-call") {
    const controller = new AbortController();
    return {
      sessionId: "test",
      turnId: 1,
      workspaceRoot: testDir,
      dataDir: testDir,
      abortSignal: controller.signal,
      callId,
      askPermission: async () => true,
      hookCtx: undefined,
      toolName: "edit",
    };
  }

  async function runEdit(args: { path: string; old_string: string; new_string: string; replace_all?: boolean }, callId = "test-call") {
    try {
      const result = await executor.run(editTool, args, makeCtx(args.path, callId), "allow");
      console.log("runEdit result:", typeof result, result);
      if (typeof result === "string") {
        return { title: "edit", output: result, isError: false, metadata: undefined };
      }
      return result;
    } catch (err) {
      console.log("runEdit caught:", err);
      if (err instanceof SandboxError) {
        return {
          title: "edit",
          output: err.message,
          isError: true,
          metadata: err.metadata,
        };
      }
      throw err;
    }
  }

  it("exact match succeeds (happy path unchanged)", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "hello world\nfoo bar\n");

    const result = await runEdit({ path: filePath, old_string: "hello world", new_string: "goodbye world" });

    expect(result.isError).not.toBe(true);
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("goodbye world\nfoo bar\n");
  });

  it("mismatched indentation returns suggestion", async () => {
    const filePath = join(testDir, "test.ts");
    await writeFile(filePath, `function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}`);

    const result = await runEdit(
      { path: filePath, old_string: `function foo() {
const a = 1;
const b = 2;
return a + b;
}`, new_string: "function foo() { return 42; }" },
      "call-1"
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("old_string not found");
    expect(result.output).toContain("Closest match at lines");
    expect(result.output).toContain("similarity");
    expect(result.output).toContain("Re-issue the tool call");
  });

  it("renamed identifier returns suggestion with diff", async () => {
    const filePath = join(testDir, "test.ts");
    await writeFile(filePath, `function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}`);

    const result = await runEdit(
      { path: filePath, old_string: `function foo() {
  const a = 1;
  const b = 2;
  return a - b;
}`, new_string: "function foo() { return 42; }" },
      "call-2"
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("-");
    expect(result.output).toContain("+");
    expect(result.output).toContain("return a + b");
  });

  it("extra blank line still suggests", async () => {
    const filePath = join(testDir, "test.ts");
    await writeFile(filePath, `function foo() {
  const a = 1;
  const b = 2;
  return a + b;
}`);

    const result = await runEdit(
      { path: filePath, old_string: `function foo() {
  const a = 1;

  const b = 2;
  return a + b;
}`, new_string: "function foo() { return 42; }" },
      "call-3"
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Closest match at lines");
    expect(result.output).toContain("Re-issue");
    // Debug: log the actual suggestion
    console.log("Extra blank line suggestion:", result.output);
  });

  it("unrelated content returns legacy error (no suggestion)", async () => {
    const filePath = join(testDir, "test.ts");
    // Completely different structure - no shared keywords
    await writeFile(filePath, `function foo() {
  return 42;
}`);

    // Use an old_string with zero structural overlap
    const result = await runEdit(
      { path: filePath, old_string: `const completelyDifferent = "nothing in common";`, new_string: "x" },
      "call-4"
    );

    expect(result.isError).toBe(true);
    // Should return legacy error (no suggestion) - score below threshold or no significant overlap
    expect(result.output).toBe(
      `ERROR edit: old_string not found in ${filePath}. Include exact surrounding context.`
    );
  });

  it("repetitive file returns legacy error (ambiguous)", async () => {
    const filePath = join(testDir, "test.ts");
    await writeFile(filePath, `const x = 1;
const x = 1;
const x = 1;
const x = 1;
`);

    // Use an old_string that doesn't match at all to test ambiguous fuzzy path
    const result = await runEdit(
      { path: filePath, old_string: `const y = 2;`, new_string: "const z = 3;" },
      "call-5"
    );

    expect(result.isError).toBe(true);
    // Should NOT contain suggestion because ambiguous (or no good match)
    expect(result.output).toBe(
      `ERROR edit: old_string not found in ${filePath}. Include exact surrounding context.`
    );
  });

  it("single-line file works", async () => {
    const filePath = join(testDir, "test.js");
    // File has "const a = 1;" - close to "const a = 2" (different value)
    await writeFile(filePath, "const a = 1; const c = 3;");

    const result = await runEdit(
      { path: filePath, old_string: "const a = 2", new_string: "const a = 99" },
      "call-6"
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Closest match at lines");
    expect(result.output).toContain("Re-issue");
  });

  it("empty old_string returns legacy error", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "hello world");

    const result = await runEdit(
      { path: filePath, old_string: "", new_string: "x" },
      "call-7"
    );

    expect(result.isError).toBe(true);
    expect(result.output).toBe(
      `ERROR edit: old_string not found in ${filePath}. Include exact surrounding context.`
    );
  });

  it("suggestion is informational only — never auto-applied", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "foo\nbar\nbaz\n");

    const result = await runEdit(
      { path: filePath, old_string: "fo\nbar", new_string: "wrong" },
      "call-8"
    );

    expect(result.isError).toBe(true);
    // File should be unchanged
    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("foo\nbar\nbaz\n");
  });
});
