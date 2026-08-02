import { describe, expect, test } from "bun:test";
import { formatElapsed, formatRuntimeInfo } from "./runtime-format";

describe("formatElapsed", () => {
  test("milliseconds below one second", () => {
    expect(formatElapsed(0)).toBe("0ms");
    expect(formatElapsed(842)).toBe("842ms");
    expect(formatElapsed(999)).toBe("999ms");
  });

  test("seconds with one decimal below one minute", () => {
    expect(formatElapsed(1_000)).toBe("1.0s");
    expect(formatElapsed(12_500)).toBe("12.5s");
    expect(formatElapsed(59_999)).toBe("60.0s");
  });

  test("minutes with integer seconds at or above one minute", () => {
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(151_000)).toBe("2m 31s");
    expect(formatElapsed(3_659_000)).toBe("60m 59s");
  });
});

describe("formatRuntimeInfo", () => {
  const base = {
    dataDir: "/tmp/vsh-data",
    workspaceRoot: "/tmp/vsh-workspace",
    mode: "dev",
  };

  test("omits turn_elapsed when turnStart is not provided", () => {
    const out = formatRuntimeInfo({
      ...base,
      now: new Date("2026-07-12T21:00:00.000Z"),
    });
    expect(out).toContain("- datetime: 2026-07-12T21:00:00.000Z");
    expect(out).not.toContain("turn_elapsed");
  });

  test("renders turn_elapsed after datetime when turnStart is provided", () => {
    const out = formatRuntimeInfo({
      ...base,
      now: new Date("2026-07-12T21:00:12.500Z"),
      turnStart: new Date("2026-07-12T21:00:00.000Z"),
    });
    expect(out).toContain("- datetime: 2026-07-12T21:00:12.500Z");
    expect(out).toContain("- turn_elapsed: 12.5s");
    expect(out.indexOf("- turn_elapsed:")).toBeGreaterThan(out.indexOf("- datetime:"));
  });

  test("renders 0ms when now equals turnStart", () => {
    const out = formatRuntimeInfo({
      ...base,
      now: new Date("2026-07-12T21:00:00.000Z"),
      turnStart: new Date("2026-07-12T21:00:00.000Z"),
    });
    expect(out).toContain("- turn_elapsed: 0ms");
  });
});
