import type {
  CoverageLimitation,
  FindingsStatus,
  Issue,
  LegacyStatus,
  RunStatus,
  StoppedReason,
  TestingRunResponse,
} from "../types/report.js";
import { getTestTypeAvailability } from "../testing/test-types.js";
import type { RunContext } from "../testing/run-context.js";

export class ReportAggregator {
  aggregate(context: RunContext, completedAt: string): TestingRunResponse {
    context.diagnostics.completedAt = completedAt;
    context.diagnostics.ai.calls = context.aiCalls ?? context.openRouterCalls ?? 0;
    context.diagnostics.crawl.acceptedUrls = [...context.visitedUrls];
    context.diagnostics.crawl.skippedUrls = [...context.skippedUrls.entries()].map(([url, reason]) => ({ url, reason }));
    context.diagnostics.crawl.failedUrls = [...context.failedUrls.entries()].map(([url, reason]) => ({ url, reason }));
    const pages = context.pageReports;
    const tests = pages.flatMap((page) => page.tests);
    // No test ever carries id "ai-planning" — an AI-pipeline failure is never
    // synthesized as a test case, so failedTests here reflects only real
    // observations about the target. AI failures surface through
    // diagnostics.ai.failures and coverageLimitations instead. See the
    // "issue_4" bug in DESIGN-DECISIONS.md's originating report.
    const failedTests = tests.filter((test) => test.status === "FAILED" || test.status === "ERROR");
    const aiPlanningFailed = context.diagnostics.ai.failures.length > 0;
    // Artifacts only report a size once the artifact manager records one; until
    // then this sums to 0 rather than guessing. See DESIGN-DECISIONS.md.
    const totalArtifactBytes = pages
      .flatMap((page) => page.evidence)
      .reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0);
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

    // FORMS and FORM_VALIDATION each have a deterministic half (always runs)
    // and an AI-assisted half (planning-dependent). Reporting a plain
    // "executed: true" when the AI half produced nothing overstates coverage
    // — see the "FORMS row" bug in DESIGN-DECISIONS.md's originating report.
    const AI_ASSISTED_TYPES = new Set(["FORMS", "FORM_VALIDATION"]);
    const aiBudgetExhausted = context.diagnostics.ai.calls >= context.diagnostics.ai.maxCalls && context.diagnostics.ai.maxCalls > 0;
    // Distinct from aiBudgetExhausted (calls): this is DESIGN-DECISIONS.md §5's
    // MAX_AI_TEST_CASES_PER_RUN — the run-wide cap on cases, AI-generated or
    // deterministic-fallback alike. Excess cases are truncated_by_budget, never
    // silently dropped.
    const aiCaseBudgetExhausted = context.diagnostics.ai.testCasesDropped > 0;
    const coverageLimitations: CoverageLimitation[] = context.request.testTypes.map((testType) => {
      const availability = getTestTypeAvailability(testType);
      if (availability === "implemented") {
        if (AI_ASSISTED_TYPES.has(testType)) {
          if (context.diagnostics.ai.disabled) {
            return {
              testType,
              availability,
              executed: true,
              reason: "Deterministic form inventory executed. AI-assisted case generation is disabled for this run (AI call budget is 0).",
            };
          }
          if (aiPlanningFailed) {
            const reasons = [...new Set(context.diagnostics.ai.failures.map((failure) => failure.reason).filter(Boolean))];
            return {
              testType,
              availability,
              executed: true,
              reason: `Deterministic form inventory executed. AI-assisted case generation failed on at least one page${reasons.length ? ` (${reasons.join(", ")})` : ""}; see diagnostics.ai.failures.`,
            };
          }
          if (aiBudgetExhausted) {
            return {
              testType,
              availability,
              executed: true,
              reason: `Deterministic form inventory executed. The AI call budget (${context.diagnostics.ai.maxCalls}) was exhausted before all pages received AI-assisted case generation.`,
            };
          }
          if (aiCaseBudgetExhausted) {
            return {
              testType,
              availability,
              executed: true,
              reason: `Deterministic form inventory executed. AI-assisted case generation hit the run-wide test-case budget (${context.diagnostics.ai.maxTestCases}); excess cases were truncated_by_budget.`,
            };
          }
          return {
            testType,
            availability,
            executed: true,
            reason: "Deterministic form inventory executed and AI-assisted case generation completed.",
          };
        }
        return {
          testType,
          availability,
          executed: true,
          reason: "Selected and executed with current implementation support.",
        };
      }
      if (availability === "partial") {
        return {
          testType,
          availability,
          executed: false,
          reason: "Selected, but current implementation only supports limited results for this test type.",
        };
      }
      return {
        testType,
        availability,
        executed: false,
        reason: "Selected, but this test type is still planned and produces limited coverage only.",
      };
    });

    // Counted from the reason prefix the crawler writes when it drains a
    // non-empty stack, so a truncated crawl is visible in the summary rather
    // than only in diagnostics. See DESIGN-DECISIONS.md §9.
    const pagesNotReached = [...context.skippedUrls.values()].filter((reason) => reason.startsWith("not-reached:")).length;
    const summary = {
      pagesDiscovered: context.visitedUrls.size + context.skippedUrls.size + context.failedUrls.size,
      pagesTested: pages.filter((page) => page.status !== "SKIPPED").length,
      pagesSkipped: context.skippedUrls.size,
      pagesNotReached,
      testsExecuted: tests.length,
      passedTests: tests.filter((test) => test.status === "PASSED").length,
      failedTests: failedTests.length,
      skippedTests: tests.filter((test) => test.status === "SKIPPED").length,
      blockedByPolicy: tests.filter((test) => test.status === "BLOCKED_BY_POLICY").length,
      inconclusiveTests: tests.filter((test) => test.status === "INCONCLUSIVE").length,
      consoleErrors: pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
      failedNetworkRequests: pages.reduce((sum, page) => sum + page.failedNetworkRequests.length, 0),
      artifactsBytes: totalArtifactBytes,
    };

    const runStatus: RunStatus = context.pageReports.some((page) => page.status === "ERROR")
      ? "ERRORED"
      : context.control?.isStopped()
        ? "STOPPED"
        : "COMPLETED";
    const findingsStatus: FindingsStatus =
      failedTests.length > 0
        ? "ISSUES_FOUND"
        : summary.testsExecuted === 0 || summary.inconclusiveTests > 0 || aiPlanningFailed
          ? "INCONCLUSIVE"
          : "PASSED";
    // ERRORED always wins, even if the crawler recorded a reason before the
    // error occurred. Otherwise trust the crawler's own recorded reason —
    // it knows whether it stopped on a stop request, a budget, or converged
    // naturally. Only falls back to inference if the crawler never set one
    // (e.g. the run failed before crawling started).
    const stoppedReason: StoppedReason | undefined = runStatus === "ERRORED"
      ? "error"
      : (context.stoppedReason ?? (runStatus === "STOPPED" ? "user_stopped" : "converged"));
    const status = toLegacyStatus(runStatus, findingsStatus);

    return {
      runId: context.runId,
      runStatus,
      findingsStatus,
      status,
      startedAt: context.startedAt,
      completedAt,
      targetOrigin: context.targetOrigin,
      selectedTestingTypes: context.request.testTypes,
      stoppedReason,
      summary,
      pages,
      issues,
      coverageLimitations,
      artifacts: pages.flatMap((page) => page.evidence),
      diagnostics: context.diagnostics,
    };
  }
}

/**
 * Maps the split statuses onto the deprecated single `status` field for existing
 * consumers. Total over all nine combinations and never emits a value outside
 * the five legacy strings. See DESIGN-DECISIONS.md for the settled mapping.
 */
export function toLegacyStatus(runStatus: RunStatus, findingsStatus: FindingsStatus): LegacyStatus {
  if (runStatus === "ERRORED") return "ERROR";
  if (runStatus === "STOPPED") return "PARTIAL";
  if (findingsStatus === "PASSED") return "PASSED";
  if (findingsStatus === "ISSUES_FOUND") return "FAILED";
  return "INCONCLUSIVE";
}
