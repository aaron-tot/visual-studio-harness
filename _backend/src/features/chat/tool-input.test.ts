import { describe, expect, test } from "bun:test";
import { normalizeToolInput } from "./tool-input";

describe("normalizeToolInput", () => {
  test("plain object passes through untouched", () => {
    const input = { action: "edit", path: "/a/b.ts", n: 3, list: [1, 2] };
    expect(normalizeToolInput(input)).toBe(input);
  });

  test("object string parses to the same object", () => {
    const obj = { action: "edit", file: "x.rs", line: 12 };
    const out = normalizeToolInput(JSON.stringify(obj));
    expect(out).toEqual(obj);
    expect(typeof out).toBe("object");
  });

  test("malformed string with embedded quote is repaired to a valid object", () => {
    // Same class of breakage as the incident: an unescaped quote inside a value.
    const malformed = '{"action": "edit", "note": "Nodes live; exposes"detail\\": \\"goes here\\" done"}';
    const out = normalizeToolInput(malformed);
    expect(typeof out).toBe("object");
    expect(out.action).toBe("edit");
  });

  test("null / undefined / number / boolean coerce to {}", () => {
    expect(normalizeToolInput(null)).toEqual({});
    expect(normalizeToolInput(undefined)).toEqual({});
    expect(normalizeToolInput(42)).toEqual({});
    expect(normalizeToolInput(true)).toEqual({});
  });

  test("empty string / whitespace coerce to {}", () => {
    expect(normalizeToolInput("")).toEqual({});
    expect(normalizeToolInput("   ")).toEqual({});
  });

  test("valid JSON that is not an object coerce to {}", () => {
    expect(normalizeToolInput('"just a string"')).toEqual({});
    expect(normalizeToolInput("[1,2,3]")).toEqual({});
  });

  test("broken JSON is rescued into a valid object (no throw)", () => {
    // jsonrepair quotes the bare token; key invariant is a valid object results.
    expect(typeof normalizeToolInput('{"a": <<<>>>}')).toBe("object");
    expect(normalizeToolInput("not json at all")).toEqual({});
  });
});
