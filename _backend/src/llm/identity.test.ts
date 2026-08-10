import { describe, expect, test } from "bun:test";
import { APP_SLUG, APP_TITLE, APP_HOMEPAGE, identityHeaders, getAppVersion } from "./identity";

describe("identity headers", () => {
  test("full header set for session + parent", () => {
    const headers = identityHeaders({ sessionId: "s1", parentSessionId: "p1" });
    expect(headers).toMatchObject({
      "X-Session-Id": "s1",
      "x-session-affinity": "s1",
      "x-parent-session-id": "p1",
      "User-Agent": `${APP_SLUG}/${getAppVersion()}`,
      "X-Title": APP_TITLE,
      "HTTP-Referer": APP_HOMEPAGE,
    });
  });

  test("no session headers when sessionId undefined", () => {
    const headers = identityHeaders({});
    expect(headers["X-Session-Id"]).toBeUndefined();
    expect(headers["x-session-affinity"]).toBeUndefined();
    expect(headers["x-parent-session-id"]).toBeUndefined();
  });

  test("empty sessionId omitted, no parent header when absent", () => {
    const headers = identityHeaders({ sessionId: "" });
    expect(headers["X-Session-Id"]).toBeUndefined();
    expect(headers["x-session-affinity"]).toBeUndefined();
    expect(headers["x-parent-session-id"]).toBeUndefined();
  });

  test("always sends UA / title / referer", () => {
    const headers = identityHeaders({});
    expect(headers["User-Agent"]).toBe(`${APP_SLUG}/${getAppVersion()}`);
    expect(headers["X-Title"]).toBe(APP_TITLE);
    expect(headers["HTTP-Referer"]).toBe(APP_HOMEPAGE);
  });

  test("getAppVersion returns a usable version", () => {
    const version = getAppVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
