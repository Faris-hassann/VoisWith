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
    expect(parsed.environment).toBe("production");
    expect(parsed.testMatrix.enabled).toBe(false);
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

  it("accepts role credentials and enabled matrix settings", () => {
    const parsed = testingRunRequestSchema.parse({
      targetUrl: "https://example.com",
      authorizationConfirmed: true,
      environment: "staging",
      testTypes: ["SMOKE", "AUTHORIZATION"],
      roles: [
        { name: "Admin", credentials: { username: "admin@example.com", password: "pw" } },
        { name: "Client", credentials: { username: "client@example.com", password: "pw" } },
      ],
      testMatrix: {
        enabled: true,
        viewports: [{ name: "mobile", width: 390, height: 844 }],
        locales: [{ name: "arabic-rtl", locale: "ar", direction: "rtl" }],
      },
    });

    expect(parsed.roles?.map((role) => role.name)).toEqual(["Admin", "Client"]);
    expect(parsed.testMatrix.locales[0]?.direction).toBe("rtl");
  });
});
