import { describe, expect, it } from "vitest";
import { PageCrawler } from "../../src/crawler/page-crawler.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { LinkSnapshot } from "../../src/types/testing.js";

describe("PageCrawler", () => {
  it("discovers next pages from snapshot links and respects page limits", async () => {
    const crawler = new PageCrawler();
    const context = contextFor({
      maxDepth: 3,
      maxPages: 3,
      sameOriginOnly: true,
    });
    const tested: string[] = [];
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": [
        {
          text: "About",
          href: "https://example.com/about?utm_source=x",
          canonicalHref: "https://example.com/about",
          internal: true,
          sourceElementId: "element_1",
        },
        {
          text: "External",
          href: "https://other.example/",
          canonicalHref: "https://other.example/",
          internal: false,
        },
      ],
      "https://example.com/about": [
        {
          text: "Contact",
          href: "https://example.com/contact",
          canonicalHref: "https://example.com/contact",
          internal: true,
        },
      ],
    };

    await crawler.crawl({
      context,
      testPage: async (url) => {
        tested.push(url);
        return {
          report: reportFor(url),
          links: linksByUrl[url] ?? [],
        };
      },
    });

    expect(tested).toEqual(["https://example.com/", "https://example.com/about", "https://example.com/contact"]);
    expect(context.visitedUrls.has("https://example.com/about")).toBe(true);
    expect(context.visitedUrls.has("https://example.com/contact")).toBe(true);
    expect(context.pendingUrls.has("https://example.com/about")).toBe(false);
    expect(context.pendingUrls.has("https://example.com/contact")).toBe(false);
    expect(context.skippedUrls.get("https://other.example/")).toBe("outside-origin");
  });
});

function contextFor(input: { maxDepth: number; maxPages: number; sameOriginOnly: boolean }): RunContext {
  return {
    runId: "run_1",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: {
      targetUrl: "https://example.com/",
      authorizationConfirmed: true,
      testTypes: ["SMOKE"],
      crawl: {
        strategy: "DFS",
        maxDepth: input.maxDepth,
        maxPages: input.maxPages,
        sameOriginOnly: input.sameOriginOnly,
        includePatterns: [],
        excludePatterns: [],
      },
      browser: {
        channel: "chrome",
        headless: false,
        viewport: { width: 1280, height: 720 },
      },
      execution: {
        safeMode: true,
        allowFormSubmission: true,
        allowFileUploads: false,
        allowDestructiveActions: false,
        allowPayments: false,
        maximumActionsPerPage: 5,
        maximumRunDurationSeconds: 60,
      },
    },
    visitedUrls: new Set(),
    pendingUrls: new Set(),
    skippedUrls: new Map(),
    failedUrls: new Map(),
    redirectHistory: new Map(),
    pageReports: [],
    previousPageSummaries: [],
    previousTestResults: [],
    knownWorkflows: [],
    generatedEntities: [],
    openRouterCalls: 0,
    deadlineMs: Date.now() + 60_000,
    artifactRoot: "",
    diagnostics: {
      runId: "run_1",
      targetUrl: "https://example.com/",
      startedAt: new Date().toISOString(),
      browser: { launched: false },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: {
        acceptedUrls: [],
        skippedUrls: [],
        failedUrls: [],
        discoveredCandidates: 0,
        noInternalLinksPages: [],
        events: [],
      },
      pages: [],
      ai: { calls: 0, maxCalls: 50, disabled: false, openRouterConfigured: true, modelConfigured: true, successes: 0, failures: [], validationFailures: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
    },
  };
}

function reportFor(url: string) {
  return {
    url,
    canonicalUrl: url,
    status: "PASSED" as const,
    tests: [],
    consoleErrors: [],
    failedNetworkRequests: [],
    performanceObservations: [],
    evidence: [],
  };
}
