import { describe, expect, it } from "vitest";
import { PageCrawler } from "../../src/crawler/page-crawler.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { LinkSnapshot } from "../../src/types/testing.js";

/**
 * Covers every crawler exit path against context.stoppedReason. Regression
 * coverage for the bug where a deadline-terminated crawl reported
 * `stoppedReason: "converged"` — see DESIGN-DECISIONS.md §3, §9.
 */
describe("PageCrawler stoppedReason", () => {
  it("reports converged when the DFS stack empties naturally", async () => {
    const context = contextFor({});
    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: [] }),
    });
    expect(context.stoppedReason).toBe("converged");
  });

  it("reports user_stopped when the run was stopped by request", async () => {
    const context = contextFor({});
    context.control = { isStopped: () => true, waitWhilePaused: async () => undefined };
    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: [] }),
    });
    expect(context.stoppedReason).toBe("user_stopped");
  });

  it("reports time_budget when the run deadline is already exceeded", async () => {
    const context = contextFor({});
    context.deadlineMs = Date.now() - 1;
    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: [] }),
    });
    expect(context.stoppedReason).toBe("time_budget");
  });

  it("reports page_budget when maxPages is reached before the stack empties", async () => {
    const context = contextFor({ maxPages: 1 });
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": [
        { text: "About", href: "https://example.com/about", canonicalHref: "https://example.com/about", internal: true },
      ],
    };
    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: linksByUrl[url] ?? [] }),
    });
    expect(context.stoppedReason).toBe("page_budget");
  });

  it("reports depth_budget when the stack empties naturally but URLs were pruned by depth", async () => {
    const context = contextFor({ maxDepth: 0 });
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": [
        { text: "About", href: "https://example.com/about", canonicalHref: "https://example.com/about", internal: true },
      ],
    };
    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: linksByUrl[url] ?? [] }),
    });
    // Only the seed (depth 0) is tested; /about (depth 1) is pruned by maxDepth: 0,
    // and the stack still empties naturally afterward.
    expect(context.visitedUrls.has("https://example.com/about")).toBe(false);
    expect(context.stoppedReason).toBe("depth_budget");
  });
});

function contextFor(overrides: { maxDepth?: number; maxPages?: number }): RunContext {
  return {
    runId: "run_stopped_reason",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: {
      targetUrl: "https://example.com/",
      authorizationConfirmed: true,
      testTypes: ["SMOKE"],
      crawl: {
        strategy: "DFS",
        maxDepth: overrides.maxDepth,
        maxPages: overrides.maxPages,
        sameOriginOnly: true,
        includePatterns: [],
        excludePatterns: [],
      },
      browser: { channel: "chrome", headless: false, viewport: { width: 1280, height: 720 } },
      execution: {
        safeMode: true,
        allowFormSubmission: false,
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
      runId: "run_stopped_reason",
      targetUrl: "https://example.com/",
      startedAt: new Date().toISOString(),
      browser: { launched: false },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 0, maxCalls: 25, disabled: false, openRouterConfigured: false, modelConfigured: false, successes: 0, failures: [], validationFailures: [], recoveredAttempts: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
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
