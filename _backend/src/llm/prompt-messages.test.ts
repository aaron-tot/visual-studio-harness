import { describe, expect, test } from "bun:test";
import { splitSystemInstructions } from "./prompt-messages";
import type { Message } from "../../../_shared/types";

function msg(
  role: Message["role"],
  content: string
): Message {
  return { role, content, timestamp: new Date().toISOString() };
}

describe("splitSystemInstructions", () => {
  test("lifts system messages into instructions", () => {
    const out = splitSystemInstructions([
      msg("system", "You are a subagent."),
      msg("user", "Create a file"),
    ]);
    expect(out.instructions).toBe("You are a subagent.");
    expect(out.messages).toEqual([{ role: "user", content: "Create a file" }]);
  });

  test("joins multiple system messages", () => {
    const out = splitSystemInstructions([
      msg("system", "Global rules"),
      msg("system", "Subagent rules"),
      msg("user", "hi"),
      msg("assistant", "hello"),
    ]);
    expect(out.instructions).toBe("Global rules\n\nSubagent rules");
    expect(out.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  test("returns undefined instructions when no system messages", () => {
    const out = splitSystemInstructions([
      msg("user", "hi"),
      msg("assistant", "hello"),
    ]);
    expect(out.instructions).toBeUndefined();
    expect(out.messages).toHaveLength(2);
  });

  test("skips empty system content", () => {
    const out = splitSystemInstructions([
      msg("system", "   "),
      msg("user", "hi"),
    ]);
    expect(out.instructions).toBeUndefined();
    expect(out.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
