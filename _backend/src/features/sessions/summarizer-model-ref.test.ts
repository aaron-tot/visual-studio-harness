import { describe, test, expect } from "bun:test";
import { splitModelRef } from "./summarizer";

/**
 * Stored summarization refs are "Provider/" + model id. OpenRouter model ids
 * themselves contain slashes (vendor/model). Validation must split on the
 * FIRST slash only — the same contract as validModelRefParts.
 */
describe("splitModelRef", () => {
  test("accepts Openrouter vendor/model ids (more than one slash)", () => {
    expect(splitModelRef("Openrouter/deepseek/deepseek-v4-flash-0731")).toEqual({
      providerName: "Openrouter",
      modelName: "deepseek/deepseek-v4-flash-0731",
    });
  });

  test("accepts a plain Provider/Model ref", () => {
    expect(splitModelRef("OpenCode Zen/nemotron-3-ultra-free")).toEqual({
      providerName: "OpenCode Zen",
      modelName: "nemotron-3-ultra-free",
    });
  });

  test("rejects missing model", () => {
    expect(splitModelRef("Openrouter/")).toBeNull();
  });

  test("rejects missing provider", () => {
    expect(splitModelRef("/deepseek/deepseek-v4-flash-0731")).toBeNull();
  });

  test("rejects null / empty", () => {
    expect(splitModelRef(null)).toBeNull();
    expect(splitModelRef("")).toBeNull();
  });
});
