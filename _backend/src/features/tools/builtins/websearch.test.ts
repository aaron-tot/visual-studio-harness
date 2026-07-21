import { describe, expect, test } from "bun:test";
import {
  parseMcpToolText,
  readWebSearchFlags,
  selectWebSearchProvider,
  webSearchProviderLabel,
} from "./websearch";
import { htmlToMarkdown, htmlToText } from "./webfetch";

describe("selectWebSearchProvider", () => {
  test("per-call override wins", () => {
    expect(
      selectWebSearchProvider("ses_a", {
        override: "parallel",
        flags: { exa: true, parallel: false },
        env: { WEBSEARCH_PROVIDER: "exa" },
      })
    ).toBe("parallel");
  });

  test("env WEBSEARCH_PROVIDER", () => {
    expect(
      selectWebSearchProvider("ses_a", {
        env: { WEBSEARCH_PROVIDER: "exa" },
        flags: { exa: false, parallel: false },
      })
    ).toBe("exa");
    expect(
      selectWebSearchProvider("ses_a", {
        env: { VISUAL_STUDIO_HARNESS_WEBSEARCH_PROVIDER: "parallel" },
        flags: { exa: true, parallel: false },
      })
    ).toBe("parallel");
  });

  test("flags pick single backend", () => {
    expect(
      selectWebSearchProvider("ses_a", {
        flags: { exa: true, parallel: false },
        env: {},
      })
    ).toBe("exa");
    expect(
      selectWebSearchProvider("ses_a", {
        flags: { exa: false, parallel: true },
        env: {},
      })
    ).toBe("parallel");
  });

  test("stable A/B per session", () => {
    const a = selectWebSearchProvider("session-stable-1", {
      flags: { exa: false, parallel: false },
      env: {},
    });
    const b = selectWebSearchProvider("session-stable-1", {
      flags: { exa: false, parallel: false },
      env: {},
    });
    expect(a).toBe(b);
    expect(a === "exa" || a === "parallel").toBe(true);
  });

  test("labels", () => {
    expect(webSearchProviderLabel("exa")).toBe("Exa Web Search");
    expect(webSearchProviderLabel("parallel")).toBe("Parallel Web Search");
  });
});

describe("readWebSearchFlags", () => {
  test("truthy env variants", () => {
    expect(readWebSearchFlags({ VISUAL_STUDIO_HARNESS_ENABLE_EXA: "1" }).exa).toBe(true);
    expect(readWebSearchFlags({ OPENCODE_ENABLE_PARALLEL: "true" }).parallel).toBe(
      true
    );
    expect(readWebSearchFlags({}).exa).toBe(false);
  });
});

describe("parseMcpToolText", () => {
  test("direct JSON result", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "hello search" }],
      },
    });
    expect(parseMcpToolText(body)).toBe("hello search");
  });

  test("SSE data line", () => {
    const body =
      "event: message\ndata: " +
      JSON.stringify({
        result: { content: [{ type: "text", text: "from sse" }] },
      }) +
      "\n\n";
    expect(parseMcpToolText(body)).toBe("from sse");
  });

  test("error payload throws", () => {
    const body = JSON.stringify({
      error: { message: "rate limited" },
    });
    expect(() => parseMcpToolText(body)).toThrow("rate limited");
  });
});

describe("webfetch html helpers", () => {
  test("htmlToText strips tags", () => {
    const t = htmlToText("<html><body><p>Hi <b>there</b></p><script>x</script></body></html>");
    expect(t).toContain("Hi");
    expect(t).toContain("there");
    expect(t).not.toContain("script");
  });

  test("htmlToMarkdown keeps links and headings", () => {
    const md = htmlToMarkdown(
      '<h1>Title</h1><p>See <a href="https://example.com">docs</a>.</p>'
    );
    expect(md).toContain("# Title");
    expect(md).toContain("[docs](https://example.com)");
  });
});
