// ═══════════════════════════════════════════════════════════════════════════════
// 🚨 DO NOT MODIFY THIS MODEL without explicit user approval. This action list
//     is the source of truth for the session-mixed-parts e2e test. Changing
//     the number of actions, their order, their types, or their args will
//     change the expected output and silently break the progressive-match
//     regression gate. The test's "before the start" and "must improve"
//     checks depend on this exact sequence.
// ═══════════════════════════════════════════════════════════════════════════════

import { executeActions, type MockAction } from "./shared";
import type { AsyncGenerator } from "../../../../_shared/types";

export const actions: MockAction[] = [
  { type: "text", prefix: "a", count: 500 },
  { type: "tool", toolName: "bash", args: { command: "echo first tool" } },
  { type: "text", prefix: "b", count: 500 },
  { type: "tool", toolName: "read", args: { path: "data/hello.txt" } },
  { type: "text", prefix: "c", count: 500 },
  { type: "tool", toolName: "write", args: { path: "new.txt", content: "created by one-of-each" } },
  { type: "text", prefix: "d", count: 500 },
  { type: "tool", toolName: "grep", args: { pattern: "Hello" } },
  { type: "text", prefix: "e", count: 500 },
  { type: "tool", toolName: "glob", args: { pattern: "*.txt" } },
  { type: "text", prefix: "f", count: 500 },
  { type: "tool", toolName: "apply_patch", args: { path: "patch.txt", patchText: "test patch content" } },
  { type: "text", prefix: "g", count: 500 },
  { type: "tool", toolName: "find_symbol", args: { query: "greet" } },
  { type: "text", prefix: "h", count: 500 },
  { type: "tool", toolName: "read_symbol", args: { name: "Calculator" } },
  { type: "text", prefix: "i", count: 500 },
  { type: "tool", toolName: "todoread", args: {} },
  { type: "text", prefix: "j", count: 500 },
  { type: "tool", toolName: "todowrite", args: { content: "implement feature X", status: "pending", priority: "high" } },
];

export function stream(speed: number, signal?: AbortSignal, workspaceRoot?: string): AsyncGenerator<any> {
  return executeActions(actions, speed, signal, workspaceRoot);
}
