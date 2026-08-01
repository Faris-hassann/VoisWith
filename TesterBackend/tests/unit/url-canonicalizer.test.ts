import { describe, expect, it } from "vitest";
import { canonicalizeUrl, looksLikeLoopUrl } from "../../src/crawler/url-canonicalizer.js";

describe("canonicalizeUrl", () => {
  it("removes fragments, tracking params, and trailing slash", () => {
    const result = canonicalizeUrl("https://example.com/path/?b=2&utm_source=x&a=1#frag");
    expect(result).toEqual({
      accepted: true,
      url: "https://example.com/path?a=1&b=2",
    });
  });

  it("rejects unsafe protocols and logout links", () => {
    expect(canonicalizeUrl("javascript:alert(1)").accepted).toBe(false);
    expect(canonicalizeUrl("https://example.com/logout").accepted).toBe(false);
  });

  it("detects loop-like pagination", () => {
    expect(looksLikeLoopUrl("https://example.com/list?page=250")).toBe(true);
  });
});
