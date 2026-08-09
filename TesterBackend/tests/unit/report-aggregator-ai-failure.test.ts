import { describe, expect, it } from "vitest";
import { ReportAggregator } from "../../src/reporting/report-aggregator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { PageReport } from "../../src/types/report.js";

/**
 * Regression coverage for the "issue_4" and "FORMS row" bugs: an AI-pipeline
 * failure (misconfiguration, transport error, ...) must never appear as an
 * issue attributed to the target, and the FORMS/FORM_VALIDATION coverage rows
 * must say which half of the check actually ran. See
 * DESIGN-DECISIONS.md's originating report.
 */
describe("ReportAggregator AI failure handling", () => {
  it("produces zero issues from an AI planning failure and names it in coverageLimitations", () => {
    const page: PageReport = {
      url: "https://example.com/services/ai-edge",
      canonicalUrl: "https://example.com/services/ai-edge",
      status: "PASSED",
      tests: [
        {
          id: "baseline-smoke",
          name: "Page loads",
          type: "SMOKE",
          status: "PASSED",
          steps: [],
          assertions: [],
          evidence: [],
          reproductionSteps: [],
        },
      ],
      consoleErrors: [],
      failedNetworkRequests: [],
      performanceObservations: [],
      evidence: [],
      skippedReason: "AI test-case planning failed (llm_unavailable): OpenRouter responded 404.",
    };

    const context = contextFor({ testTypes: ["SMOKE", "FORMS"], pages: [page] });
    context.diagnostics.ai.failures.push({
      pageUrl: page.url,
      message: "OpenRouter responded 404 for model vendor/model:free.",
      reason: "llm_unavailable",
    });

    const report = new ReportAggregator().aggregate(context, new Date().toISOString());

    expect(report.issues).toHaveLength(0);
    expect(report.issues.some((issue) => issue.description.includes("OpenRouter"))).toBe(false);

    const formsRow = report.coverageLimitations.find((row) => row.testType === "FORMS");
    expect(formsRow?.executed).toBe(true);
    expect(formsRow?.reason).toContain("Deterministic form inventory executed");
    expect(formsRow?.reason).toContain("llm_unavailable");

    // The AI failure still surfaces — just as findings uncertainty, not a target defect.
    expect(report.findingsStatus).toBe("INCONCLUSIVE");
  });

  it("reports a clean FORMS row when AI planning succeeds", () => {
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
    const context = contextFor({ testTypes: ["FORMS"], pages: [page] });

    const report = new ReportAggregator().aggregate(context, new Date().toISOString());
    const formsRow = report.coverageLimitations.find((row) => row.testType === "FORMS");
    expect(formsRow?.reason).toBe("Deterministic form inventory executed and AI-assisted case generation completed.");
    expect(report.findingsStatus).toBe("PASSED");
  });
});

function contextFor(input: { testTypes: RunContext["request"]["testTypes"]; pages: PageReport[] }): RunContext {
  return {
    runId: "run_ai_failure",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: {
      targetUrl: "https://example.com/",
      authorizationConfirmed: true,
      testTypes: input.testTypes,
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
    visitedUrls: new Set(input.pages.map((page) => page.url)),
    pendingUrls: new Set(),
    skippedUrls: new Map(),
    failedUrls: new Map(),
    redirectHistory: new Map(),
    pageReports: input.pages,
    previousPageSummaries: [],
    previousTestResults: [],
    knownWorkflows: [],
    generatedEntities: [],
    openRouterCalls: 1,
    stoppedReason: "converged",
    deadlineMs: Date.now() + 60_000,
    artifactRoot: "",
    diagnostics: {
      runId: "run_ai_failure",
      targetUrl: "https://example.com/",
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 1, maxCalls: 25, disabled: false, openRouterConfigured: true, modelConfigured: true, successes: 0, failures: [], validationFailures: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
    },
  };
}
