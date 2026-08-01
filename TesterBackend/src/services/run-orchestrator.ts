import crypto from "node:crypto";
import { ArtifactManager } from "../artifacts/artifact-manager.js";
import { AuthenticationHandler } from "../authentication/authentication-handler.js";
import { BrowserManager, type BrowserSession } from "../browser/browser-manager.js";
import { ConsoleCollector } from "../collectors/console-collector.js";
import { EvidenceCollector } from "../collectors/evidence-collector.js";
import { NetworkCollector } from "../collectors/network-collector.js";
import { PerformanceCollector } from "../collectors/performance-collector.js";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import { PageCrawler } from "../crawler/page-crawler.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { PageInspector } from "../inspection/page-inspector.js";
import { ReportAggregator } from "../reporting/report-aggregator.js";
import { assertSafeTargetUrl } from "../security/ssrf-protection.js";
import { redactSecrets } from "../security/secret-redaction.js";
import type { RunContext } from "../testing/run-context.js";
import { buildPageBaselineTests } from "../testing/page-baseline-tests.js";
import type { TestAction, TestCase, TestPlan } from "../types/ai.js";
import type { PageReport, TestCaseResult, TestStepResult, TestingRunResponse } from "../types/report.js";
import type { ElementInventoryItem, TestingRunRequest } from "../types/testing.js";
import { deadlineFromNow } from "../utilities/timeout.js";
import { AiTestPlanner } from "../ai/ai-test-planner.js";
import { ActionPolicyEngine } from "../actions/action-policy-engine.js";
import { PlaywrightActionExecutor } from "../actions/playwright-action-executor.js";
import { AssertionEngine } from "../assertions/assertion-engine.js";

let activeRuns = 0;

export class RunOrchestrator {
  private readonly browserManager = new BrowserManager();
  private readonly authentication = new AuthenticationHandler();
  private readonly crawler = new PageCrawler();
  private readonly inspector = new PageInspector();
  private readonly planner = new AiTestPlanner();
  private readonly policy = new ActionPolicyEngine();
  private readonly aggregator = new ReportAggregator();

  async run(request: TestingRunRequest): Promise<TestingRunResponse> {
    if (activeRuns >= config.limits.maxConcurrentRuns) {
      throw new AppError({
        code: ERROR_CODES.RUN_TIMEOUT,
        message: "Maximum concurrent test runs reached.",
        statusCode: 429,
      });
    }

    activeRuns += 1;
    const startedAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    const target = await assertSafeTargetUrl(request.targetUrl, config.security);
    const artifacts = new ArtifactManager(config.artifacts.root, runId);
    await artifacts.initialize();

    const context: RunContext = {
      runId,
      startedAt,
      targetOrigin: target.origin,
      request: {
        ...request,
        crawl: {
          ...request.crawl,
          maxDepth: Math.min(request.crawl.maxDepth, config.limits.maxDepthPerRun),
          maxPages: Math.min(request.crawl.maxPages, config.limits.maxPagesPerRun),
        },
        execution: {
          ...request.execution,
          maximumActionsPerPage: Math.min(
            request.execution.maximumActionsPerPage,
            config.limits.maxActionsPerPage,
          ),
          maximumRunDurationSeconds: Math.min(
            request.execution.maximumRunDurationSeconds,
            config.limits.maxRunDurationSeconds,
          ),
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
      deadlineMs: deadlineFromNow(request.execution.maximumRunDurationSeconds),
      artifactRoot: artifacts.runRoot,
      diagnostics: {
        runId,
        targetUrl: request.targetUrl,
        startedAt,
        browser: { launched: false },
        login: { status: request.credentials ? "FAILED" : "SKIPPED", message: request.credentials ? "Login not attempted yet." : "No credentials supplied." },
        crawl: {
          acceptedUrls: [],
          skippedUrls: [],
          failedUrls: [],
          discoveredCandidates: 0,
          noInternalLinksPages: [],
          events: [],
        },
        pages: [],
        ai: {
          calls: 0,
          successes: 0,
          failures: [],
          validationFailures: [],
        },
      },
    };

    let session: BrowserSession | undefined;
    try {
      logger.info({ runId, targetUrl: request.targetUrl }, "Test run started");
      session = await this.browserManager.launch(context.request, artifacts.downloadsDir);
      context.diagnostics.browser.launched = true;
      logger.info({ runId }, "Browser launched");
      const consoleCollector = new ConsoleCollector();
      const networkCollector = new NetworkCollector(context.targetOrigin);
      const performanceCollector = new PerformanceCollector();
      const evidenceCollector = new EvidenceCollector(artifacts);
      consoleCollector.attach(session.page);
      networkCollector.attach(session.page);

      const initialNavigationStarted = Date.now();
      context.diagnostics.initialNavigation = {
        name: "Initial navigation",
        status: "STARTED",
        timestamp: new Date().toISOString(),
        url: target.toString(),
      };
      await session.page.goto(target.toString(), { waitUntil: "domcontentloaded" });
      context.diagnostics.initialNavigation = {
        name: "Initial navigation",
        status: "PASSED",
        timestamp: new Date().toISOString(),
        url: target.toString(),
        durationMs: Date.now() - initialNavigationStarted,
      };
      context.diagnostics.finalUrl = session.page.url();
      logger.info({ runId, url: target.toString(), finalUrl: session.page.url(), durationMs: Date.now() - initialNavigationStarted }, "Initial navigation completed");
      try {
        const loginMessage = await this.authentication.authenticate(session.page, context.request.credentials);
        context.diagnostics.login = {
          status: context.request.credentials ? "PASSED" : "SKIPPED",
          message: loginMessage ?? "No credentials supplied.",
        };
      } catch (error) {
        context.diagnostics.login = {
          status: error instanceof AppError && error.code === ERROR_CODES.HUMAN_AUTHENTICATION_REQUIRED ? "HUMAN_REQUIRED" : "FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
        throw error;
      }
      if (context.request.credentials) {
        context.request.credentials.password = "";
      }

      await this.crawler.crawl({
        context,
        page: session.page,
        testPage: async (url) =>
          this.testPage({
            context,
            session: session as BrowserSession,
            url,
            consoleCollector,
            networkCollector,
            performanceCollector,
            evidenceCollector,
            artifacts,
          }),
      });

      const report = this.aggregator.aggregate(context, new Date().toISOString());
      logger.info({ runId, status: report.status, summary: report.summary }, "Test run completed");
      return report;
    } catch (error) {
      logger.error({ err: redactSecrets(error), runId }, "Test run failed");
      if (!context.diagnostics.browser.launched) {
        context.diagnostics.browser.error = error instanceof Error ? error.message : String(error);
      }
      if (error instanceof AppError && error.fatal) throw error;
      context.pageReports.push({
        url: request.targetUrl,
        canonicalUrl: target.toString(),
        status: "ERROR",
        tests: [],
        consoleErrors: [],
        failedNetworkRequests: [],
        performanceObservations: [],
        evidence: [],
        skippedReason: error instanceof Error ? error.message : String(error),
      });
      return { ...this.aggregator.aggregate(context, new Date().toISOString()), status: "ERROR" };
    } finally {
      if (context.request.credentials) {
        context.request.credentials.username = "";
        context.request.credentials.password = "";
      }
      await this.browserManager.close(session);
      activeRuns -= 1;
    }
  }

  private async testPage(input: {
    context: RunContext;
    session: BrowserSession;
    url: string;
    consoleCollector: ConsoleCollector;
    networkCollector: NetworkCollector;
    performanceCollector: PerformanceCollector;
    evidenceCollector: EvidenceCollector;
    artifacts: ArtifactManager;
  }): Promise<PageReport> {
    const { context, session, url } = input;
    if (context.openRouterCalls >= config.limits.maxOpenRouterCallsPerRun) {
      return {
        url,
        canonicalUrl: url,
        status: "SKIPPED",
        tests: [
          {
            id: "ai-call-budget",
            name: "AI planning budget",
            type: "SMOKE",
            status: "SKIPPED",
            steps: [],
            assertions: [],
            actualResult: `Maximum AI calls per run reached: ${config.limits.maxOpenRouterCallsPerRun}`,
            evidence: [],
            reproductionSteps: [`Open ${url}`],
            confidence: 1,
          },
        ],
        consoleErrors: [],
        failedNetworkRequests: [],
        performanceObservations: [],
        evidence: [],
        skippedReason: "Maximum AI calls per run reached.",
      };
    }
    await assertSafeTargetUrl(url, config.security);
    logger.info({ runId: context.runId, url }, "Page navigation started");
    const navigationStarted = Date.now();
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    const navigationMs = Date.now() - navigationStarted;
    logger.info({ runId: context.runId, url, finalUrl: session.page.url(), navigationMs }, "Page navigation completed");

    const performance = await input.performanceCollector.collect(session.page);
    const snapshot = await this.inspector.inspect({
      page: session.page,
      targetOrigin: context.targetOrigin,
      consoleErrors: input.consoleCollector.all(),
      failedRequests: input.networkCollector.failed(),
      observedApiCalls: input.networkCollector.apiCalls(),
    });
    snapshot.performance = performance;
    logger.info(
      {
        runId: context.runId,
        url: snapshot.url,
        elements: snapshot.elements.length,
        forms: snapshot.forms.length,
        links: snapshot.links.length,
      },
      "Testing page",
    );

    const baselineResults = buildPageBaselineTests({
      snapshot,
      selectedTypes: context.request.testTypes,
      credentialsProvided: Boolean(context.request.credentials?.username),
    });

    let plan: TestPlan;
    let aiPlannedTests = 0;
    try {
      plan = await this.planner.plan(context, snapshot);
      aiPlannedTests = plan.testCases.length;
      context.diagnostics.ai.successes += 1;
      logger.info({ runId: context.runId, url: snapshot.url, aiPlannedTests }, "AI planning completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.diagnostics.ai.failures.push({ pageUrl: snapshot.url, message });
      if (error instanceof AppError && error.code === ERROR_CODES.INVALID_AI_RESPONSE) {
        context.diagnostics.ai.validationFailures.push({ pageUrl: snapshot.url, message });
      }
      logger.warn({ err: redactSecrets(error), runId: context.runId, url: snapshot.url }, "AI planning failed");
      const evidence = await input.evidenceCollector.screenshotOnFailure(
        session.page,
        `${context.runId}-ai-plan-failure`,
        "AI planning failed.",
      );
      const pageReport: PageReport = {
        url: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl,
        status: summarizePageStatus([
          ...baselineResults,
          {
            id: "ai-planning",
            name: "AI planning",
            type: "SMOKE",
            status: "ERROR",
            steps: [],
            assertions: [],
            error: message,
            actualResult: message,
            evidence,
            reproductionSteps: [`Open ${snapshot.url}`, "Request AI test plan"],
            confidence: 0.9,
          },
        ]),
        tests: [
          ...baselineResults,
          {
            id: "ai-planning",
            name: "AI planning",
            type: "SMOKE",
            status: "ERROR",
            steps: [],
            assertions: [],
            error: message,
            actualResult: message,
            evidence,
            reproductionSteps: [`Open ${snapshot.url}`, "Request AI test plan"],
            confidence: 0.9,
          },
        ],
        consoleErrors: snapshot.consoleErrors,
        failedNetworkRequests: snapshot.failedRequests,
        performanceObservations: snapshot.performance,
        evidence,
      };
      this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, 0, navigationMs);
      await this.writePageReportArtifact(input.artifacts, context, pageReport);
      return pageReport;
    }

    context.previousPageSummaries.push(plan.pageSummary);
    const testResults: TestCaseResult[] = [...baselineResults];
    const executor = new PlaywrightActionExecutor(context.runId);
    const assertionEngine = new AssertionEngine();
    const elementMap = new Map(snapshot.elements.map((element) => [element.id, element]));

    for (const testCase of plan.testCases.slice(0, context.request.execution.maximumActionsPerPage)) {
      const result = await this.executeTestCase({
        context,
        session,
        testCase,
        elementMap,
        executor,
        assertionEngine,
        evidenceCollector: input.evidenceCollector,
      });
      context.previousTestResults.push(`${result.name}: ${result.status}`);
      testResults.push(result);
    }

    const pageReport: PageReport = {
      url: snapshot.url,
      canonicalUrl: snapshot.canonicalUrl,
      status: summarizePageStatus(testResults),
      tests: testResults,
      consoleErrors: snapshot.consoleErrors,
      failedNetworkRequests: snapshot.failedRequests,
      performanceObservations: snapshot.performance,
      evidence: [],
    };
    this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, aiPlannedTests, navigationMs);
    await this.writePageReportArtifact(input.artifacts, context, pageReport);
    return pageReport;
  }

  private recordPageDiagnostics(
    context: RunContext,
    pageReport: PageReport,
    snapshot: Awaited<ReturnType<PageInspector["inspect"]>>,
    baselineTests: number,
    aiPlannedTests: number,
    navigationMs: number,
  ): void {
    const buttons = snapshot.elements.filter((element) => element.kind === "button" || element.kind === "submit").length;
    const inputs = snapshot.elements.filter((element) =>
      ["input", "textarea", "select", "checkbox", "radio", "file"].includes(element.kind),
    ).length;
    const internalLinks = snapshot.links.filter((link) => link.internal).length;
    if (internalLinks === 0) {
      context.diagnostics.crawl.noInternalLinksPages.push(snapshot.url);
    }
    context.diagnostics.pages.push({
      url: snapshot.url,
      finalUrl: snapshot.url,
      status: pageReport.status,
      navigationMs,
      links: snapshot.links.length,
      internalLinks,
      forms: snapshot.forms.length,
      buttons,
      inputs,
      consoleErrors: snapshot.consoleErrors.length,
      networkFailures: snapshot.failedRequests.length,
      baselineTests,
      aiPlannedTests,
    });
  }

  private async writePageReportArtifact(
    artifacts: ArtifactManager,
    context: RunContext,
    pageReport: PageReport,
  ): Promise<void> {
    try {
      const runId = context.runId;
      const slug = pageReport.canonicalUrl
        .replace(/^https?:\/\//, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 100);
      const evidence = await artifacts.writeJson("reports", `${runId}-${slug || "page"}.json`, pageReport);
      pageReport.evidence.push({
        ...evidence,
        description: "Per-page report generated immediately after page testing.",
      });
      const pageDiagnostic = context.diagnostics.pages.find((page) => page.url === pageReport.url);
      if (pageDiagnostic) {
        pageDiagnostic.reportArtifactPath = evidence.path;
      }
      logger.info(
        {
          runId,
          url: pageReport.url,
          tests: pageReport.tests.length,
          status: pageReport.status,
          artifact: evidence.path,
        },
        "Page report generated",
      );
    } catch (error) {
      logger.warn(
        { err: redactSecrets(error), runId: context.runId, url: pageReport.url },
        "Failed to write per-page report artifact",
      );
    }
  }

  private async executeTestCase(input: {
    context: RunContext;
    session: BrowserSession;
    testCase: TestCase;
    elementMap: Map<string, ElementInventoryItem>;
    executor: PlaywrightActionExecutor;
    assertionEngine: AssertionEngine;
    evidenceCollector: EvidenceCollector;
  }): Promise<TestCaseResult> {
    const steps: TestStepResult[] = [];
    const assertions: TestStepResult[] = [];
    const reproductionSteps: string[] = [];

    for (const action of input.testCase.steps) {
      const step = await this.executeAction(input, action);
      steps.push(step);
      reproductionSteps.push(action.description ?? action.action);
      if (step.status !== "PASSED") {
        const evidence = await input.evidenceCollector.screenshotOnFailure(
          input.session.page,
          `${input.context.runId}-${input.testCase.id}-step-failure`,
          "Step failed.",
        );
        return {
          id: input.testCase.id,
          name: input.testCase.name,
          type: input.testCase.type,
          priority: input.testCase.priority,
          status: step.status,
          steps,
          assertions,
          error: step.error,
          evidence,
          reproductionSteps,
          severity: step.status === "BLOCKED_BY_POLICY" ? "INFORMATIONAL" : "MEDIUM",
          confidence: 0.75,
        };
      }
    }

    for (const action of input.testCase.assertions) {
      const element = action.elementId ? input.elementMap.get(action.elementId) : undefined;
      const assertion = await input.assertionEngine.assert(input.session.page, action, element);
      assertions.push(assertion);
    }

    const failedAssertion = assertions.find((assertion) => assertion.status !== "PASSED");
    const evidence = failedAssertion
      ? await input.evidenceCollector.screenshotOnFailure(
          input.session.page,
          `${input.context.runId}-${input.testCase.id}-assertion-failure`,
          "Assertion failed.",
        )
      : [];

    return {
      id: input.testCase.id,
      name: input.testCase.name,
      type: input.testCase.type,
      priority: input.testCase.priority,
      status: failedAssertion ? "FAILED" : "PASSED",
      steps,
      assertions,
      expectedResult: input.testCase.assertions.map((assertion) => assertion.description ?? assertion.action).join("; "),
      actualResult: failedAssertion?.actualResult ?? "All planned steps and assertions passed.",
      error: failedAssertion?.error,
      evidence,
      reproductionSteps,
      severity: failedAssertion ? "MEDIUM" : undefined,
      confidence: 0.75,
    };
  }

  private async executeAction(
    input: {
      context: RunContext;
      session: BrowserSession;
      testCase: TestCase;
      elementMap: Map<string, ElementInventoryItem>;
      executor: PlaywrightActionExecutor;
    },
    action: TestAction,
  ): Promise<TestStepResult> {
    const element = action.elementId ? input.elementMap.get(action.elementId) : undefined;
    const decision = this.policy.decide({
      action,
      testCase: input.testCase,
      request: input.context.request,
      element,
    });
    if (!decision.allowed) {
      return {
        action,
        status: "BLOCKED_BY_POLICY",
        expectedResult: "Action approved by safety policy",
        actualResult: decision.reason,
        error: decision.reason,
      };
    }
    return input.executor.execute(input.session.page, action, element);
  }
}

function summarizePageStatus(results: TestCaseResult[]): PageReport["status"] {
  if (results.some((result) => result.status === "FAILED" || result.status === "ERROR")) return "FAILED";
  if (results.some((result) => result.status === "BLOCKED_BY_POLICY")) return "BLOCKED_BY_POLICY";
  if (results.length === 0) return "INCONCLUSIVE";
  if (results.some((result) => result.status === "INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASSED";
}
