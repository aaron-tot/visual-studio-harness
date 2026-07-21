import { describe, expect, test } from "bun:test";
import { serverOriginFromBaseUrl } from "./slots";

describe("serverOriginFromBaseUrl", () => {
  test("strips /v1", () => {
    expect(serverOriginFromBaseUrl("http://localhost:8080/v1")).toBe(
      "http://localhost:8080"
    );
    expect(serverOriginFromBaseUrl("http://localhost:8080/v1/")).toBe(
      "http://localhost:8080"
    );
  });

  test("keeps non-v1 paths", () => {
    expect(serverOriginFromBaseUrl("http://127.0.0.1:9292")).toBe(
      "http://127.0.0.1:9292"
    );
  });
});
