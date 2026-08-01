import { describe, expect, it } from "vitest";
import { testingRunRequestSchema } from "../../src/schemas/testing-request.schema.js";

describe("testingRunRequestSchema", () => {
  it("applies safe defaults", () => {
    const parsed = testingRunRequestSchema.parse({
      targetUrl: "https://example.com",
      authorizationConfirmed: true,
      testTypes: ["SMOKE"],
    });

    expect(parsed.browser.headless).toBe(false);
    expect(parsed.browser.channel).toBe("chrome");
    expect(parsed.crawl.strategy).toBe("DFS");
    expect(parsed.execution.safeMode).toBe(true);
    expect(parsed.execution.allowDestructiveActions).toBe(false);
  });

  it("requires authorization confirmation", () => {
    expect(() =>
      testingRunRequestSchema.parse({
        targetUrl: "https://example.com",
        authorizationConfirmed: false,
        testTypes: ["SMOKE"],
      }),
    ).toThrow();
  });
});
