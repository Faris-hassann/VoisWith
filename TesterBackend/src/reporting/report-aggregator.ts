import type {
  CoverageLimitation,
  Issue,
  RunStatus,
  TestingRunResponse,
} from "../types/report.js";
import type { RunContext } from "../testing/run-context.js";

export class ReportAggregator {
  aggregate(context: RunContext, completedAt: string): TestingRunResponse {
    context.diagnostics.completedAt = completedAt;
    context.diagnostics.ai.calls = context.openRouterCalls;
    context.diagnostics.crawl.acceptedUrls = [...context.visitedUrls];
    context.diagnostics.crawl.skippedUrls = [...context.skippedUrls.entries()].map(([url, reason]) => ({ url, reason }));
    context.diagnostics.crawl.failedUrls = [...context.failedUrls.entries()].map(([url, reason]) => ({ url, reason }));
    const pages = context.pageReports;
    const tests = pages.flatMap((page) => page.tests);
    const failedTests = tests.filter((test) => test.status === "FAILED" || test.status === "ERROR");
    const aiFailureTests = failedTests.filter((test) => test.id === "ai-planning");
    const nonAiFailedTests = failedTests.filter((test) => test.id !== "ai-planning");
    const issues: Issue[] = [
      ...failedTests.map((test, index): Issue => ({
        id: `issue_${index + 1}`,
        severity: test.severity ?? "MEDIUM",
        title: test.name,
        description: test.error ?? test.actualResult ?? "Test failed.",
        pageUrl: pages.find((page) => page.tests.includes(test))?.url,
        role: pages.find((page) => page.tests.includes(test))?.role,
        viewport: pages.find((page) => page.tests.includes(test))?.viewport,
        locale: pages.find((page) => page.tests.includes(test))?.locale,
        testName: test.name,
        evidence: test.evidence,
        confidence: test.confidence ?? 0.7,
      })),
    ];

    const coverageLimitations: CoverageLimitation[] = [
      {
        area: "Security testing",
        reason: "Only passive non-exploitative checks are performed by default.",
      },
      ...(context.request.testTypes.includes("AUTHORIZATION")
        ? [
            {
              area: "Authorization",
              reason: "Skipped unless multiple role credentials are supplied in a future request structure.",
            },
          ]
        : []),
      ...(context.request.testTypes.includes("REGRESSION_BASELINE")
        ? [
            {
              area: "Regression baseline",
              reason: "Skipped unless a baseline is provided or available.",
            },
          ]
        : []),
      ...context.diagnostics.ai.failures.map((failure) => ({
        area: "AI planning",
        reason: failure.pageUrl ? `${failure.pageUrl}: ${failure.message}` : failure.message,
        recommendation: "Check OPENROUTER_API_KEY, OPENROUTER_MODEL, model availability, and structured JSON output support.",
      })),
      ...context.diagnostics.crawl.skippedUrls.slice(0, 20).map((skipped) => ({
        area: "Skipped URL",
        reason: `${skipped.url}: ${skipped.reason}`,
      })),
      ...context.diagnostics.crawl.failedUrls.slice(0, 20).map((failed) => ({
        area: "Failed URL",
        reason: `${failed.url}: ${failed.reason}`,
      })),
      ...context.diagnostics.crawl.noInternalLinksPages.map((url) => ({
        area: "Crawl discovery",
        reason: `${url}: no same-origin links were accepted for DFS discovery.`,
        recommendation: "Confirm the page exposes normal anchor links and that include/exclude/same-origin settings are not too strict.",
      })),
    ];

    const summary = {
      pagesDiscovered: context.visitedUrls.size + context.skippedUrls.size + context.failedUrls.size,
      pagesTested: pages.filter((page) => page.status !== "SKIPPED").length,
      pagesSkipped: context.skippedUrls.size,
      testsExecuted: tests.length,
      passedTests: tests.filter((test) => test.status === "PASSED").length,
      failedTests: nonAiFailedTests.length,
      skippedTests: tests.filter((test) => test.status === "SKIPPED").length,
      blockedByPolicy: tests.filter((test) => test.status === "BLOCKED_BY_POLICY").length,
      inconclusiveTests: tests.filter((test) => test.status === "INCONCLUSIVE").length,
      consoleErrors: pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
      failedNetworkRequests: pages.reduce((sum, page) => sum + page.failedNetworkRequests.length, 0),
    };

    const status: RunStatus =
      nonAiFailedTests.length > 0
        ? "FAILED"
        : summary.blockedByPolicy > 0 || summary.inconclusiveTests > 0 || aiFailureTests.length > 0
          ? "PARTIAL"
          : summary.testsExecuted === 0
            ? "INCONCLUSIVE"
            : "PASSED";

    return {
      runId: context.runId,
      status,
      startedAt: context.startedAt,
      completedAt,
      targetOrigin: context.targetOrigin,
      selectedTestingTypes: context.request.testTypes,
      summary,
      pages,
      issues,
      coverageLimitations,
      artifacts: pages.flatMap((page) => page.evidence),
      diagnostics: context.diagnostics,
    };
  }
}
