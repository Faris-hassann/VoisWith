import { describe, expect, it } from "vitest";
import { buildLinkHealthTests } from "../../src/testing/link-health-checker.js";
import type { TestingRunRequest } from "../../src/types/testing.js";

describe("buildLinkHealthTests", () => {
  it("checks same-origin and external links without crawling external pages", async () => {
    const requestedUrls: string[] = [];
    const results = await buildLinkHealthTests({
      targetOrigin: "https://example.com",
      request: request(),
      links: [
        {
          text: "Dashboard",
          href: "https://example.com/dashboard",
          canonicalHref: "https://example.com/dashboard",
          internal: true,
        },
        {
          text: "Docs",
          href: "https://docs.example.org",
          canonicalHref: "https://docs.example.org/",
          internal: false,
        },
      ],
      page: {
        context: () => ({
          request: {
            get: async (url: string) => {
              requestedUrls.push(url);
              return { status: () => 200 };
            },
          },
        }),
      } as never,
    });

    expect(requestedUrls).toEqual(["https://example.com/dashboard"]);
    expect(results.map((result) => result.status)).toEqual(["PASSED", "FAILED"]);
  });
});

function request(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    testTypes: ["LINKS"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 1,
      maximumRunDurationSeconds: 30,
    },
  };
}
