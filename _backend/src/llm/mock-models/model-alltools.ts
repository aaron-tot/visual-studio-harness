import { emitTokens, emitToolFn as emitTool, emitThinkingFn as emitThinking } from "./shared";
import type { AsyncGenerator } from "../../../../_shared/types";

export async function* stream(speed: number, signal?: AbortSignal): AsyncGenerator<any> {
  const ti = { v: 0 };

  yield* emitTokens("a", 1, 20, ti, speed, signal);
  yield* emitTool("bash", { command: "echo hello from test model" }, "hello from test model\n", speed);
  yield* emitTokens("a", 21, 40, ti, speed, signal);
  yield* emitTool("write", { path: "newfile.txt", content: "created by agent" }, null, speed);
  yield* emitTokens("a", 41, 60, ti, speed, signal);
  yield* emitTool("todoread", {}, null, speed);
  yield* emitTokens("a", 61, 80, ti, speed, signal);
  yield* emitTool("todowrite", { todos: [{ id: "1", content: "test task", status: "pending", priority: "high" }] }, null, speed);
  yield* emitTokens("a", 81, 100, ti, speed, signal);
  yield* emitTool("read", { path: "data/hello.txt" }, "Hello world!\nThis is a test file.", speed);

  yield* emitTokens("b", 1, 20, ti, speed, signal);
  yield* emitTool("edit", { path: "editthis.txt", old_string: "original content", new_string: "edited content" }, null, speed);
  yield* emitTokens("b", 21, 40, ti, speed, signal);
  yield* emitTool("grep", { pattern: "Hello", path: "data/" }, null, speed);
  yield* emitTokens("b", 41, 60, ti, speed, signal);
  yield* emitTool("glob", { pattern: "**/*.txt" }, null, speed);
  yield* emitTokens("b", 61, 80, ti, speed, signal);
  yield* emitTool("apply_patch", { patchText: "*** Update File: editthis.txt\nSEARCH:\nedited content\nREPLACE:\npatched content\n" }, null, speed);

  yield* emitTokens("c", 1, 20, ti, speed, signal);
  yield* emitTool("find_symbol", { query: "greet", path: "src" }, null, speed);
  yield* emitTokens("c", 21, 40, ti, speed, signal);
  yield* emitTool("read_symbol", { name: "greet", path: "src/index.ts" }, null, speed);
  yield* emitTokens("c", 41, 60, ti, speed, signal);
  yield* emitThinking(["Let", " me", " reconsider", "..."], speed, signal);
  yield* emitTokens("c", 61, 80, ti, speed, signal);
  yield* emitTool("webfetch", { url: "https://example.com", format: "text" }, null, speed);
  yield* emitTokens("c", 81, 100, ti, speed, signal);
  yield* emitTool("websearch", { query: "playwright test 2026", numResults: 1, type: "fast" }, null, speed);
  yield* emitTokens("c", 101, 120, ti, speed, signal);
  yield* emitThinking(["Finalizing", "..."], speed, signal);
  yield* emitTokens("c", 121, 140, ti, speed, signal);
  yield* emitTool("skill", { name: "test-skill" }, null, speed);
}
