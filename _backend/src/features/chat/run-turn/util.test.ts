import { describe, expect, test } from "bun:test";
import { generateId } from "./util";

describe("generateId", () => {
  test("id starts with sessionID_", () => {
    expect(generateId().startsWith("sessionID_")).toBe(true);
  });

  test("id is unique across calls", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });

  test("id keeps the timestamp + hash shape after the prefix", () => {
    const id = generateId();
    const rest = id.slice("sessionID_".length);
    // date_time_hash (date YYYY-MM-DD, time HH-MM-SS, 6 hex chars)
    expect(rest).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[0-9a-f]{6}$/);
  });
});
