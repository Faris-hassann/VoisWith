import { describe, expect, it } from "vitest";
import { ReportAggregator } from "../../src/reporting/report-aggregator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { PageReport } from "../../src/types/report.js";

/**
 * DESIGN-DECISIONS.md §5: MAX_AI_TEST_CASES_PER_RUN truncation must be
 * reported distinctly from MAX_AI_CALLS_PER_RUN exhaustion — they are
 * different budgets with different causes.
 */
describe("ReportAggregator case-budget truncation", () => {
  it("reports truncated_by_budget when the run-wide test-case cap dropped cases", () => {
    const context = contextFor({ testCasesDropped: 12, calls: 3, maxCalls: 25 });

    const report = new ReportAggregator().aggregate(context, new Date().toISOString());

    const formsRow = report.coverageLimitations.find((row) => row.testType === "FORMS");
    expect(formsRow?.reason).toContain("truncated_by_budget");
    expect(formsRow?.executed).toBe(true);
  });

  it("does not say truncated_by_budget when only the call budget was exhausted", () => {
    const context = contextFor({ testCasesDropped: 0, calls: 25, maxCalls: 25 });

    const report = new ReportAggregator().aggregate(context, new Date().toISOString());

    const formsRow = report.coverageLimitations.find((row) => row.testType === "FORMS");
    expect(formsRow?.reason).not.toContain("truncated_by_budget");
    expect(formsRow?.reason).toContain("AI call budget");
  });

  it("reports a clean row when neither budget was hit", () => {
    const context = contextFor({ testCasesDropped: 0, calls: 3, maxCalls: 25 });

    const report = new ReportAggregator().aggregate(context, new Date().toISOString());

    const formsRow = report.coverageLimitations.find((row) => row.testType === "FORMS");
    expect(formsRow?.reason).toBe("Deterministic form inventory executed and AI-assisted case generation completed.");
  });
});

function contextFor(input: { testCasesDropped: number; calls: number; maxCalls: number }): RunContext {
  const page: PageReport = {
    url: "https://example.com/contact",
    canonicalUrl: "https://example.com/contact",
    status: "PASSED",
    tests: [
      { id: "baseline-smoke", name: "Page loads", type: "SMOKE", status: "PASSED", steps: [], assertions: [], evidence: [], reproductionSteps: [] },
    ],
    consoleErrors: [],
    failedNetworkRequests: [],
    performanceObservations: [],
    evidence: [],
  };

  return {
    runId: "run_truncation",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: {
      targetUrl: "https://example.com/",
      authorizationConfirmed: true,
      testTypes: ["FORMS"],
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
    visitedUrls: new Set([page.url]),
    pendingUrls: new Set(),
    skippedUrls: new Map(),
    failedUrls: new Map(),
    redirectHistory: new Map(),
    pageReports: [page],
    previousPageSummaries: [],
    previousTestResults: [],
    knownWorkflows: [],
    generatedEntities: [],
    openRouterCalls: input.calls,
    stoppedReason: "converged",
    deadlineMs: Date.now() + 60_000,
    artifactRoot: "",
    diagnostics: {
      runId: "run_truncation",
      targetUrl: "https://example.com/",
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: {
        calls: input.calls,
        maxCalls: input.maxCalls,
        disabled: false,
        openRouterConfigured: true,
        modelConfigured: true,
        successes: 1,
        failures: [],
        validationFailures: [],
        maxTestCases: 400,
        testCasesGenerated: input.testCasesDropped > 0 ? 400 : 50,
        testCasesDropped: input.testCasesDropped,
        deterministicFallbacks: 0,
      },
    },
  };
}
