import { describe, expect, it } from "vitest";
import { PageCrawler } from "../../src/crawler/page-crawler.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { LinkSnapshot } from "../../src/types/testing.js";

/**
 * Regression coverage for the Phase 3 `/contact` blocker (DESIGN-DECISIONS.md §14).
 *
 * A 6-page fixture crawl ran out of time with `/contact` still queued. Two
 * things went wrong beyond the budget itself, and both are what this file pins:
 *
 *  1. The page was never popped, yet nothing in the report said so — its only
 *     trace was a `duplicate-or-visited` entry left by an unrelated repeat nav
 *     link, which reads as a benign duplicate rather than lost coverage.
 *  2. A repeat link to an already-visited page was recorded as "skipped" at
 *     all, which made `skippedUrls` useless as a coverage signal.
 *
 * On the pre-fix code both assertions below fail: `skippedUrls` carried
 * `duplicate-or-visited` instead of `not-reached:*`, and `unreachedUrls` did
 * not exist. A crawl that stops early must be distinguishable from one that
 * finished.
 */
describe("PageCrawler unreached URL accounting", () => {
  it("records every still-queued URL as not-reached when the deadline ends the crawl", async () => {
    const context = contextFor();
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": [
        link("Login", "https://example.com/login"),
        link("Contact", "https://example.com/contact"),
      ],
    };

    await new PageCrawler().crawl({
      context,
      testPage: async (url) => {
        // Blow the budget while testing the seed, leaving both discovered
        // links queued but unvisited — the exact shape of the live failure.
        context.deadlineMs = Date.now() - 1;
        return { report: reportFor(url), links: linksByUrl[url] ?? [] };
      },
    });

    expect(context.stoppedReason).toBe("time_budget");
    expect(context.visitedUrls.has("https://example.com/contact")).toBe(false);

    // The page must be visibly unreached, not silently absent.
    expect(context.skippedUrls.get("https://example.com/contact")).toBe("not-reached:time_budget");
    expect(context.skippedUrls.get("https://example.com/login")).toBe("not-reached:time_budget");
    expect(context.diagnostics.crawl.unreachedUrls).toEqual(
      expect.arrayContaining(["https://example.com/contact", "https://example.com/login"]),
    );
  });

  it("leaves unreachedUrls empty and records no skips when the crawl converges", async () => {
    const context = contextFor();
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": [link("Contact", "https://example.com/contact")],
    };

    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: linksByUrl[url] ?? [] }),
    });

    expect(context.stoppedReason).toBe("converged");
    expect(context.visitedUrls.has("https://example.com/contact")).toBe(true);
    expect(context.diagnostics.crawl.unreachedUrls ?? []).toEqual([]);
    expect([...context.skippedUrls.keys()]).toEqual([]);
  });

  it("does not record an already-visited page as skipped when a later page links back to it", async () => {
    const context = contextFor();
    // Every page carries the same nav, so the seed is linked from its own
    // child. That repeat link is accounted for, not skipped.
    const nav = [link("Home", "https://example.com/"), link("Contact", "https://example.com/contact")];
    const linksByUrl: Record<string, LinkSnapshot[]> = {
      "https://example.com/": nav,
      "https://example.com/contact": nav,
    };

    await new PageCrawler().crawl({
      context,
      testPage: async (url) => ({ report: reportFor(url), links: linksByUrl[url] ?? [] }),
    });

    expect(context.stoppedReason).toBe("converged");
    expect(context.visitedUrls.has("https://example.com/")).toBe(true);
    expect(context.visitedUrls.has("https://example.com/contact")).toBe(true);
    // Both pages were fully tested; neither may appear as a skip.
    expect(context.skippedUrls.has("https://example.com/")).toBe(false);
    expect(context.skippedUrls.has("https://example.com/contact")).toBe(false);
  });
});

function link(text: string, href: string): LinkSnapshot {
  return { text, href, canonicalHref: href, internal: true };
}

function contextFor(): RunContext {
  return {
    runId: "run_unreached",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: {
      targetUrl: "https://example.com/",
      authorizationConfirmed: true,
      testTypes: ["SMOKE"],
      crawl: { strategy: "DFS", sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
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
      runId: "run_unreached",
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
