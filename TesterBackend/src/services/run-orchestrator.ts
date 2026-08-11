import crypto from "node:crypto";
import type { Page } from "playwright";
import { ArtifactManager } from "../artifacts/artifact-manager.js";
import { AuthenticationHandler } from "../authentication/authentication-handler.js";
import { BrowserManager, type BrowserSession } from "../browser/browser-manager.js";
import { scrollPageForDiscovery, withCursorSuppressed } from "../browser/browser-visual-agent.js";
import { ConsoleCollector } from "../collectors/console-collector.js";
import { EvidenceCollector } from "../collectors/evidence-collector.js";
import { NetworkCollector } from "../collectors/network-collector.js";
import { PerformanceCollector } from "../collectors/performance-collector.js";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import { PageCrawler } from "../crawler/page-crawler.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES, type LlmAttempt } from "../errors/error-codes.js";
import { errorMessage, serializeError } from "../errors/serialize-error.js";
import { PageInspector } from "../inspection/page-inspector.js";
import { ReportAggregator } from "../reporting/report-aggregator.js";
import { assertSafeTargetUrl } from "../security/ssrf-protection.js";
import { redactSecrets } from "../security/secret-redaction.js";
import type { RunContext } from "../testing/run-context.js";
import { buildPageBaselineTests } from "../testing/page-baseline-tests.js";
import { buildLinkHealthTests } from "../testing/link-health-checker.js";
import type { TestAction, TestCase } from "../types/ai.js";
import type { FormSnapshot } from "../types/llm-contract.js";
import type { PageReport, StoppedReason, TestCaseResult, TestStepResult, TestingRunResponse } from "../types/report.js";
import type { ElementInventoryItem, InspectedForm, PageSnapshot, TestingRunRequest } from "../types/testing.js";
import { buildFormSnapshotsWithForms } from "../ai/form-snapshot-builder.js";
import { classifyForm } from "../safety/form-classifier.js";
import { dedupeFormSnapshots } from "../testing/form-dedup.js";
import { executeFormTestCase } from "../testing/form-test-executor.js";
import { severityForInformational } from "../reporting/severity.js";
import { locatorFromDescriptor } from "../actions/playwright-action-executor.js";
import { deadlineFromNow } from "../utilities/timeout.js";
import { AiTestPlanner, type FormPlanResult } from "../ai/ai-test-planner.js";
import { ActionPolicyEngine } from "../actions/action-policy-engine.js";
import { PlaywrightActionExecutor } from "../actions/playwright-action-executor.js";
import { AssertionEngine } from "../assertions/assertion-engine.js";
import { buildMatrixTargets, type MatrixExecutionTarget } from "../testing/run-matrix.js";
import type { RunEventSink, RunProgressEventInput } from "../runs/run-events.js";
import { RunHistoryStore } from "../runs/run-history-store.js";

let activeRuns = 0;

export interface RunOrchestratorOptions {
  runId?: string;
  onEvent?: RunEventSink;
  control?: {
    isStopped: () => boolean;
    waitWhilePaused: () => Promise<void>;
  };
}

export class RunOrchestrator {
  private readonly browserManager = new BrowserManager();
  private readonly authentication = new AuthenticationHandler();
  private readonly crawler = new PageCrawler();
  private readonly inspector = new PageInspector();
  private readonly planner = new AiTestPlanner();
  private readonly policy = new ActionPolicyEngine();
  private readonly aggregator = new ReportAggregator();

  constructor(private readonly history = new RunHistoryStore()) {}

  async run(request: TestingRunRequest, options: RunOrchestratorOptions = {}): Promise<TestingRunResponse> {
    if (activeRuns >= config.limits.maxConcurrentRuns) {
      throw new AppError({
        code: ERROR_CODES.RUN_TIMEOUT,
        message: "Maximum concurrent test runs reached.",
        statusCode: 429,
      });
    }

    activeRuns += 1;
    const startedAt = new Date().toISOString();
    const runId = options.runId ?? crypto.randomUUID();
    const target = await assertSafeTargetUrl(request.targetUrl, config.security);
    const artifacts = new ArtifactManager(config.artifacts.root, runId);
    await artifacts.initialize();
    await this.history.initializeRun(runId, request, target.origin, startedAt);

    const context: RunContext = {
      runId,
      startedAt,
      targetOrigin: target.origin,
      request: {
        ...request,
        crawl: {
          ...request.crawl,
          maxDepth: clampOptionalLimit(request.crawl.maxDepth, config.limits.maxDepthPerRun),
          maxPages: clampOptionalLimit(request.crawl.maxPages, config.limits.maxPagesPerRun),
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
      discoveredUrls: new Set(),
      visitedStates: new Set(),
      pendingUrls: new Set(),
      pendingCrawlItems: new Set(),
      processedInteractions: new Set(),
      routeFamilies: new Map(),
      // Deliberately NOT reset per matrix target: §7's rule is one form tested
      // once for the whole run, and localContext inherits this reference.
      processedForms: new Map(),
      skippedUrls: new Map(),
      externalUrls: new Map(),
      failedUrls: new Map(),
      redirectHistory: new Map(),
      pageReports: [],
      previousPageSummaries: [],
      previousTestResults: [],
      knownWorkflows: [],
      generatedEntities: [],
      aiCalls: 0,
      deadlineMs: deadlineFromNow(request.execution.maximumRunDurationSeconds),
      artifactRoot: artifacts.runRoot,
      control: options.control,
      diagnostics: {
        runId,
        targetUrl: request.targetUrl,
        startedAt,
        browser: { launched: false },
        matrix: {
          roles: [],
          viewports: [],
          locales: [],
        },
        authorization: {
          comparisons: [],
        },
        login: { status: request.credentials ? "FAILED" : "SKIPPED", message: request.credentials ? "Login not attempted yet." : "No credentials supplied." },
        crawl: {
          acceptedUrls: [],
          skippedUrls: [],
          externalUrls: [],
          failedUrls: [],
          discoveredCandidates: 0,
          noInternalLinksPages: [],
          events: [],
        },
        pages: [],
        ai: {
          provider: "openrouter",
          providerConfigured: Boolean(config.ai.apiKey),
          calls: 0,
          maxCalls: config.limits.maxAiCallsPerRun,
          disabled: config.limits.maxAiCallsPerRun <= 0,
          successes: 0,
          failures: [],
          validationFailures: [],
          recoveredAttempts: [],
          maxTestCases: config.limits.maxAiTestCasesPerRun,
          testCasesGenerated: 0,
          testCasesDropped: 0,
          deterministicFallbacks: 0,
        },
      },
    };

    let session: BrowserSession | undefined;
    try {
      logger.info({ runId, targetUrl: request.targetUrl }, "Test run started");
      emit(options, {
        runId,
        type: "run.orchestrator_started",
        status: "started",
        message: "Backend orchestrator initialized the test run.",
      });
      emitAiDiagnostics(options, context);
      const targets = buildMatrixTargets(context.request);
      context.diagnostics.matrix = {
        roles: unique(targets.map((item) => item.role.name)),
        viewports: unique(targets.map((item) => item.viewport.name)),
        locales: unique(targets.map((item) => item.locale.name)),
      };

      for (const targetItem of targets) {
        const pagesBeforeTarget = context.pageReports.length;
        session = await this.runMatrixTarget({
          context,
          target,
          targetItem,
          artifacts,
          events: options.onEvent,
        });
        const retainTrace = context.pageReports.slice(pagesBeforeTarget).some((page) => page.status === "FAILED" || page.status === "ERROR");
        const tracePath = retainTrace
          ? `${artifacts.dir("traces")}/${traceFileName(targetItem.role.name, targetItem.viewport.name, targetItem.locale.name)}`
          : undefined;
        await this.browserManager.close(session, tracePath);
        session = undefined;
      }

      this.recordAuthorizationDiagnostics(context);

      const report = this.aggregator.aggregate(context, new Date().toISOString());
      await this.history.finalize(report);
      await this.history.sweep();
      logger.info({ runId, runStatus: report.runStatus, findingsStatus: report.findingsStatus, summary: report.summary }, "Test run completed");
      return report;
    } catch (error) {
      const serialized = serializeError(error);
      logger.error({ err: serialized, runId }, "Test run failed");
      emit(options, {
        runId,
        type: "run.error",
        status: "failed",
        message: serialized.message,
        diagnostics: serialized,
      });
      if (!context.diagnostics.browser.launched) {
        context.diagnostics.browser.error = serialized.message;
      }
      context.pageReports.push({
        url: request.targetUrl,
        canonicalUrl: target.toString(),
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        direction: context.direction,
        status: "ERROR",
        tests: [],
        consoleErrors: [],
        failedNetworkRequests: [],
        performanceObservations: [],
        evidence: [],
        skippedReason: serialized.message,
      });
      const report = this.aggregator.aggregate(context, new Date().toISOString());
      const erroredReport: TestingRunResponse = {
        ...report,
        runStatus: "ERRORED",
        status: "ERROR",
        stoppedReason: "error",
      };
      await this.history.finalize(erroredReport);
      await this.history.sweep();
      return erroredReport;
    } finally {
      if (context.request.credentials) {
        context.request.credentials.username = "";
        context.request.credentials.password = "";
      }
      for (const role of context.request.roles ?? []) {
        role.credentials.username = "";
        role.credentials.password = "";
      }
      await this.browserManager.close(session);
      activeRuns -= 1;
    }
  }

  private async runMatrixTarget(input: {
    context: RunContext;
    target: URL;
    targetItem: MatrixExecutionTarget;
    artifacts: ArtifactManager;
    events?: RunEventSink;
  }): Promise<BrowserSession> {
    const { context, target, targetItem, artifacts } = input;
    const localRequest: TestingRunRequest = {
      ...context.request,
      credentials: cloneCredentials(targetItem.role.credentials),
      browser: {
        ...context.request.browser,
        viewport: {
          width: targetItem.viewport.width,
          height: targetItem.viewport.height,
        },
      },
    };
    const localContext: RunContext = {
      ...context,
      roleName: targetItem.role.name,
      viewportName: targetItem.viewport.name,
      localeName: targetItem.locale.name,
      direction: targetItem.locale.direction,
      request: localRequest,
      visitedUrls: new Set(),
      discoveredUrls: new Set(),
      visitedStates: new Set(),
      pendingUrls: new Set(),
      pendingCrawlItems: new Set(),
      processedInteractions: new Set(),
      routeFamilies: new Map(),
      skippedUrls: new Map(),
      externalUrls: new Map(),
      failedUrls: new Map(),
    };

    logger.info(
      {
        runId: context.runId,
        role: targetItem.role.name,
        viewport: targetItem.viewport.name,
        locale: targetItem.locale.name,
      },
      "Matrix target started",
    );
    emit(input, {
      runId: context.runId,
      type: "matrix.started",
      status: "started",
      message: `Started ${targetItem.role.name} / ${targetItem.viewport.name} / ${targetItem.locale.name}.`,
      role: targetItem.role.name,
      viewport: targetItem.viewport.name,
      locale: targetItem.locale.name,
    });

    let session = await this.browserManager.launch(localRequest, artifacts.downloadsDir, {
      viewport: localRequest.browser.viewport,
      locale: targetItem.locale.locale,
      direction: targetItem.locale.direction,
      onCursor: (payload) => {
        emit(input, {
          runId: context.runId,
          type: "live-view:cursor",
          status: "info",
          message: `Live cursor ${payload.action}.`,
          pageUrl: safePageUrl(session.page),
          role: targetItem.role.name,
          viewport: targetItem.viewport.name,
          locale: targetItem.locale.name,
          liveCursor: payload,
        });
      },
    });
    context.diagnostics.browser.launched = true;
    logger.info({ runId: context.runId, role: targetItem.role.name }, "Browser launched");
    emit(input, {
      runId: context.runId,
      type: "browser.launched",
      status: "passed",
      message: "Visible Chrome launched for the matrix target.",
      role: targetItem.role.name,
      viewport: targetItem.viewport.name,
      locale: targetItem.locale.name,
    });

    const consoleCollector = new ConsoleCollector();
    const networkCollector = new NetworkCollector(context.targetOrigin);
    const performanceCollector = new PerformanceCollector();
    const evidenceCollector = new EvidenceCollector(artifacts);
    consoleCollector.attach(session.page);
    networkCollector.attach(session.page);

    const initialNavigationStarted = Date.now();
    context.diagnostics.initialNavigation ??= {
      name: "Initial navigation",
      status: "STARTED",
      timestamp: new Date().toISOString(),
      url: target.toString(),
    };
    emit(input, {
      runId: context.runId,
      type: "navigation.initial_started",
      status: "started",
      message: `Opening ${target.toString()}.`,
      pageUrl: target.toString(),
      role: targetItem.role.name,
      viewport: targetItem.viewport.name,
      locale: targetItem.locale.name,
    });
    await session.page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    if (targetItem.locale.direction === "rtl") {
      await session.page.evaluate(() => {
        document.documentElement.setAttribute("dir", "rtl");
      });
    }
    context.diagnostics.initialNavigation = {
      name: "Initial navigation",
      status: "PASSED",
      timestamp: new Date().toISOString(),
      url: target.toString(),
      durationMs: Date.now() - initialNavigationStarted,
      message: "At least one matrix target completed initial navigation.",
    };
    context.diagnostics.finalUrl = session.page.url();
    emit(input, {
      runId: context.runId,
      type: "navigation.initial_passed",
      status: "passed",
      message: "Initial page navigation completed.",
      pageUrl: session.page.url(),
      role: targetItem.role.name,
      viewport: targetItem.viewport.name,
      locale: targetItem.locale.name,
      counts: { durationMs: Date.now() - initialNavigationStarted },
    });

    try {
      emit(input, {
        runId: context.runId,
        type: "login.started",
        status: "started",
        message: localRequest.credentials ? "Login flow started." : "No credentials supplied; login skipped.",
        pageUrl: session.page.url(),
        role: targetItem.role.name,
        viewport: targetItem.viewport.name,
        locale: targetItem.locale.name,
      });
      const loginResult = await this.authentication.authenticate(session.page, localRequest.credentials);
      context.diagnostics.login = {
        status: localRequest.credentials ? "PASSED" : "SKIPPED",
        message: loginResult?.message ?? "No credentials supplied.",
        details: loginResult?.diagnostics,
      };
      if (localRequest.credentials) {
        localContext.request = {
          ...localContext.request,
          targetUrl: session.page.url(),
        };
        context.diagnostics.finalUrl = session.page.url();
      }
      emit(input, {
        runId: context.runId,
        type: localRequest.credentials ? "login.passed" : "login.skipped",
        status: localRequest.credentials ? "passed" : "skipped",
        message: loginResult?.message ?? "No credentials supplied.",
        pageUrl: session.page.url(),
        role: targetItem.role.name,
        viewport: targetItem.viewport.name,
        locale: targetItem.locale.name,
        diagnostics: loginResult?.diagnostics,
      });
    } catch (error) {
      const serialized = serializeError(error);
      const evidence = await evidenceCollector.screenshotOnFailure(
        session.page,
        `${context.runId}-${targetItem.role.name}-${targetItem.viewport.name}-${targetItem.locale.name}-login-failure`,
        "Login failed.",
      );
      context.diagnostics.login = {
        status: error instanceof AppError && error.code === ERROR_CODES.HUMAN_AUTHENTICATION_REQUIRED ? "HUMAN_REQUIRED" : "FAILED",
        message: serialized.message,
        details: serialized.details,
        evidence,
      };
      emit(input, {
        runId: context.runId,
        type: "login.failed",
        status: "skipped",
        message: `${serialized.message} Continuing public crawl anonymously.`,
        pageUrl: session.page.url(),
        role: targetItem.role.name,
        viewport: targetItem.viewport.name,
        locale: targetItem.locale.name,
        diagnostics: context.diagnostics.login,
      });
      localContext.request = {
        ...localContext.request,
        credentials: undefined,
        targetUrl: target.toString(),
      };
      await session.page.goto(target.toString(), { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }

    let lastRecycledAt = 0;
    await this.crawler.crawl({
      context: localContext,
      testPage: async (url) => {
        const pagesCompleted = localContext.visitedUrls.size;
        if (pagesCompleted > 0 && pagesCompleted % 50 === 0 && pagesCompleted !== lastRecycledAt) {
          const storageState = await session.context.storageState();
          const retainTrace = context.pageReports.some((page) => page.status === "FAILED" || page.status === "ERROR");
          const tracePath = retainTrace
            ? `${artifacts.dir("traces")}/${traceFileName(targetItem.role.name, targetItem.viewport.name, `${targetItem.locale.name}-${pagesCompleted}`)}`
            : undefined;
          await this.browserManager.close(session, tracePath);
          session = await this.browserManager.launch(localRequest, artifacts.downloadsDir, {
            viewport: localRequest.browser.viewport,
            locale: targetItem.locale.locale,
            direction: targetItem.locale.direction,
            storageState,
            onCursor: (payload) => {
              emit(input, {
                runId: context.runId,
                type: "live-view:cursor",
                status: "info",
                message: `Live cursor ${payload.action}.`,
                pageUrl: safePageUrl(session.page),
                role: targetItem.role.name,
                viewport: targetItem.viewport.name,
                locale: targetItem.locale.name,
                liveCursor: payload,
              });
            },
          });
          consoleCollector.attach(session.page);
          networkCollector.attach(session.page);
          lastRecycledAt = pagesCompleted;
          emit(input, {
            runId: context.runId,
            type: "browser.recycled",
            status: "info",
            message: `Browser context recycled after ${pagesCompleted} pages.`,
            role: targetItem.role.name,
            viewport: targetItem.viewport.name,
            locale: targetItem.locale.name,
            counts: { pagesCompleted },
          });
        }
        const result = await this.testPage({
          context: localContext,
          session,
          url,
          consoleCollector,
          networkCollector,
          performanceCollector,
          evidenceCollector,
          artifacts,
          events: input.events,
        });
        return { report: result.report, links: result.snapshot.links, stateFingerprint: result.snapshot.stateFingerprint };
      },
    });

    for (const url of localContext.visitedUrls) context.visitedUrls.add(url);
    for (const [url, reason] of localContext.skippedUrls) context.skippedUrls.set(`${targetItem.role.name}:${targetItem.viewport.name}:${targetItem.locale.name}:${url}`, reason);
    for (const [url, details] of localContext.externalUrls ?? []) context.externalUrls?.set(url, details);
    for (const [url, reason] of localContext.failedUrls) context.failedUrls.set(`${targetItem.role.name}:${targetItem.viewport.name}:${targetItem.locale.name}:${url}`, reason);
    context.aiCalls = localContext.aiCalls;
    // The crawler records stoppedReason on the *local* context, so without this
    // merge the run report silently falls back to "converged" even when a
    // target ran out of time — a truncated crawl that claims to be complete.
    context.stoppedReason = mergeStoppedReason(context.stoppedReason, localContext.stoppedReason);

    logger.info(
      {
        runId: context.runId,
        role: targetItem.role.name,
        viewport: targetItem.viewport.name,
        locale: targetItem.locale.name,
        pages: localContext.visitedUrls.size,
      },
      "Matrix target completed",
    );
    emit(input, {
      runId: context.runId,
      type: "matrix.completed",
      status: "passed",
      message: `Completed ${targetItem.role.name} / ${targetItem.viewport.name} / ${targetItem.locale.name}.`,
      role: targetItem.role.name,
      viewport: targetItem.viewport.name,
      locale: targetItem.locale.name,
      counts: { pages: localContext.visitedUrls.size },
    });
    return session;
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
    events?: RunEventSink;
  }): Promise<{ report: PageReport; snapshot: Awaited<ReturnType<PageInspector["inspect"]>> }> {
    const { context, session, url } = input;
    await assertSafeTargetUrl(url, config.security);
    logger.info({ runId: context.runId, url }, "Page navigation started");
    emit(input, {
      runId: context.runId,
      type: "page.navigation_started",
      status: "started",
      message: `Navigating to ${url}.`,
      pageUrl: url,
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
    });
    const navigationStarted = Date.now();
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    await scrollPageForDiscovery(session.page);
    const navigationMs = Date.now() - navigationStarted;
    logger.info({ runId: context.runId, url, finalUrl: session.page.url(), navigationMs }, "Page navigation completed");
    emit(input, {
      runId: context.runId,
      type: "page.navigation_passed",
      status: "passed",
      message: "Page navigation completed.",
      pageUrl: session.page.url(),
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
      counts: { durationMs: navigationMs },
    });
    await emitLiveFrame(input, session.page, "Page navigation frame.");

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
    emit(input, {
      runId: context.runId,
      type: "page.snapshot_collected",
      status: "passed",
      message: "Collected page snapshot and JS-scraped links for crawl.",
      pageUrl: snapshot.url,
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
      counts: {
        links: snapshot.links.length,
        forms: snapshot.forms.length,
        elements: snapshot.elements.length,
        images: snapshot.images.length,
        scripts: snapshot.scripts.length,
        consoleErrors: snapshot.consoleErrors.length,
        failedRequests: snapshot.failedRequests.length,
        apiCalls: snapshot.observedApiCalls.length,
      },
    });
    await emitLiveFrame(input, session.page, "Page snapshot frame.");

    const baselineResults = buildPageBaselineTests({
      snapshot,
      selectedTypes: context.request.testTypes,
      credentialsProvided: Boolean(context.request.credentials?.username),
      roleCount: context.request.roles?.length ?? (context.request.credentials ? 1 : 0),
    });
    const linkHealthResults = await buildLinkHealthTests({
      page: session.page,
      links: snapshot.links,
      targetOrigin: context.targetOrigin,
      request: context.request,
    });
    const pageEvidence = await capturePageEvidence({
      artifacts: input.artifacts,
      page: session.page,
      context,
      snapshot,
    });
    await prepareFormsForAiPlanning(input, session.page, snapshot);

    const visibleForms = snapshot.forms.filter((form) =>
      [...form.fields, ...form.submitControls].some((element) => !element.hidden),
    );
    const totalFormFields = visibleForms.reduce((sum, form) => sum + form.fields.filter((field) => !field.hidden).length, 0);
    const aiEligibility = {
      eligible: visibleForms.length > 0 && totalFormFields > 0,
      reasons: [`${visibleForms.length} visible form(s)`, `${totalFormFields} visible field(s)`],
    };
    if (!aiEligibility.eligible) {
      emit(input, {
        runId: context.runId,
        type: "ai:skipped-no-forms",
        status: "skipped",
        message: "AI skipped because no visible form inputs were discovered on this page.",
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        diagnostics: { reasons: aiEligibility.reasons },
      });
      const aiSkippedResult: TestCaseResult = {
        id: "ai-form-submission-scope",
        name: "AI form input scope",
        type: "FORMS",
        status: "SKIPPED",
        steps: [],
        assertions: [],
        actualResult: "No visible form inputs were detected on this page.",
        evidence: [],
        reproductionSteps: [`Open ${snapshot.url}`, "Inspect discovered form inputs", "Skip AI planning because no forms were found"],
        severity: "INFORMATIONAL",
        confidence: 1,
      };
      const testResults = [...baselineResults, ...linkHealthResults, aiSkippedResult];
      const pageReport: PageReport = {
        url: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl,
        stateFingerprint: snapshot.stateFingerprint,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        direction: context.direction,
        status: summarizePageStatus(testResults),
        tests: testResults,
        consoleErrors: snapshot.consoleErrors,
        failedNetworkRequests: snapshot.failedRequests,
        performanceObservations: snapshot.performance,
        evidence: pageEvidence,
        skippedReason: "AI planning requires at least one visible form input.",
      };
      this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, 0, navigationMs);
      await this.writePageReportArtifact(input.artifacts, context, pageReport, input.events);
      return { report: pageReport, snapshot };
    }

    // §4 then §7, both before the planner: a privileged form must never reach
    // the model at all, and a duplicate must never cost an AI call.
    const built = buildFormSnapshotsWithForms(
      snapshot.forms,
      snapshot.url,
      context.request.crawl.ignoredQueryParameters ?? [],
    );
    const classificationContext = { pageTitle: snapshot.title, headings: snapshot.headings, pageUrl: snapshot.url };
    const softBlockedByFormId = new Map<string, string>();
    const formsByFormId = new Map<string, InspectedForm>();
    const classifiedSnapshots: FormSnapshot[] = [];
    const blockedResults: TestCaseResult[] = [];

    for (const { snapshot: formSnapshot, form } of built) {
      formsByFormId.set(formSnapshot.formId, form);
      const classification = classifyForm(form, classificationContext);
      if (classification.decision === "blocked_privileged") {
        emit(input, {
          runId: context.runId,
          type: "form:blocked_privileged",
          status: "blocked",
          message: `Form ${formSnapshot.elementId} ${classification.block}-blocked by the privileged-form classifier (${classification.matchedSignal}).`,
          pageUrl: snapshot.url,
          role: context.roleName,
          viewport: context.viewportName,
          locale: context.localeName,
          diagnostics: { formId: formSnapshot.formId, decision: "blocked_privileged", matchedSignal: classification.matchedSignal },
        });
        if (classification.block === "hard") {
          // Never planned, never submitted — recorded so the gap is visible.
          blockedResults.push(blockedFormResult(formSnapshot.formId, formSnapshot.elementId, classification.matchedSignal, snapshot.url));
          continue;
        }
        // Soft block: still planned and filled, but the executor forces
        // submit off and records why.
        softBlockedByFormId.set(formSnapshot.formId, classification.matchedSignal);
      }
      classifiedSnapshots.push(formSnapshot);
    }

    const dedup = dedupeFormSnapshots(classifiedSnapshots, context.processedForms ??= new Map(), snapshot.url);
    for (const duplicate of dedup.duplicates) {
      emit(input, {
        runId: context.runId,
        type: "form:duplicate_skipped",
        status: "skipped",
        message: `Form ${duplicate.elementId} already tested on ${duplicate.firstPageUrl}.`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        diagnostics: { formId: duplicate.formId, decision: duplicate.decision },
      });
    }

    if (dedup.unique.length === 0) {
      emit(input, {
        runId: context.runId,
        type: "ai.planning_skipped",
        status: "skipped",
        message: `Skipping AI planning because no unique eligible forms remain on this page (${built.length} discovered, ${blockedResults.length} hard-blocked, ${dedup.duplicates.length} duplicate, 0 eligible).`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        counts: {
          discoveredForms: built.length,
          blockedForms: blockedResults.length,
          duplicateForms: dedup.duplicates.length,
          eligibleForms: 0,
        },
      });
      const testResults: TestCaseResult[] = [...baselineResults, ...linkHealthResults, ...blockedResults];
      const pageReport: PageReport = {
        url: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl,
        stateFingerprint: snapshot.stateFingerprint,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        direction: context.direction,
        status: summarizePageStatus(testResults),
        tests: testResults,
        consoleErrors: snapshot.consoleErrors,
        failedNetworkRequests: snapshot.failedRequests,
        performanceObservations: snapshot.performance,
        evidence: pageEvidence,
        skippedReason: "AI planning skipped because every discovered form was either privileged-blocked or already tested.",
      };
      this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, 0, navigationMs);
      await this.writePageReportArtifact(input.artifacts, context, pageReport, input.events);
      return { report: pageReport, snapshot };
    }

    let planResult: FormPlanResult;
    try {
      emit(input, {
        runId: context.runId,
        type: "ai.batch_started",
        status: "started",
        message: `Sending discovered form inputs to AI test-case planner (${aiEligibility.reasons.join(", ")}).`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
      });
      planResult = await this.planner.plan(context, snapshot, dedup.unique);
      logger.info(
        { runId: context.runId, url: snapshot.url, aiPlannedTests: planResult.testCases.length, source: planResult.source },
        "AI planning completed",
      );
      emit(input, {
        runId: context.runId,
        type: planResult.batchesFallenBack > 0 ? "ai.batch_failed" : "ai.planning_passed",
        status: planResult.batchesFallenBack > 0 ? "failed" : "passed",
        message: `Planned ${planResult.testCases.length} form test case(s) across ${planResult.batchesPlanned} batch(es) (${planResult.source}).`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        counts: { aiPlannedTests: planResult.testCases.length },
        diagnostics: planResult.batchesFallenBack > 0
          ? {
              batchesPlanned: planResult.batchesPlanned,
              batchesFallenBack: planResult.batchesFallenBack,
              deterministicFallbacks: planResult.batchesFallenBack,
              failures: planResult.fallbackFailures,
            }
          : undefined,
      });

      // Persist the validated plan before touching the page. If a browser
      // interaction or navigation fails later, the exact generated cases are
      // still available and auditable in the run artifacts.
      const planArtifact = await input.artifacts.writeJson(
        "reports",
        `planned-test-cases-${crypto.randomUUID().slice(0, 8)}.json`,
        {
          runId: context.runId,
          pageUrl: snapshot.url,
          source: planResult.source,
          generatedAt: new Date().toISOString(),
          testCases: planResult.testCases,
        },
      );
      pageEvidence.push({ ...planArtifact, description: "Validated form test cases saved before sequential execution." });
      emit(input, {
        runId: context.runId,
        type: "ai.plan_saved",
        status: "passed",
        message: `Saved ${planResult.testCases.length} planned form test case(s) before execution.`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        counts: { plannedTests: planResult.testCases.length },
        diagnostics: { artifactPath: planArtifact.path },
      });
      for (const testCase of planResult.testCases) {
        emit(input, {
          runId: context.runId,
          type: "test_case.planned",
          status: "info",
          message: `Planned form test case: ${testCase.intent}.`,
          pageUrl: snapshot.url,
          role: context.roleName,
          viewport: context.viewportName,
          locale: context.localeName,
          formTestCase: {
            runId: context.runId,
            caseId: testCase.caseId,
            formId: testCase.formId,
            pageUrl: snapshot.url,
            role: context.roleName,
            viewport: context.viewportName,
            locale: context.localeName,
            planningSource: normalizePlanningSource(planResult.source),
            testCase,
            status: "planned",
            submit: testCase.submit,
          },
        });
      }
    } catch (error) {
      // planner.plan() degrades to the deterministic generator internally on
      // any LLM failure — this catch only fires for a genuinely unexpected
      // error (e.g. a bug in snapshot building), so deterministic/baseline
      // checks still count fully and nothing is synthesized as a target
      // finding. It captures no screenshot: there is nothing on the page to
      // show, since planning never produced anything to act on.
      const message = errorMessage(error);
      const reason = error instanceof AppError ? error.llmFailureReason : undefined;
      const attempts = extractLlmAttempts(error);
      context.diagnostics.ai.failures.push({ pageUrl: snapshot.url, message, reason, attempts });
      logger.warn({ err: redactSecrets(error), runId: context.runId, url: snapshot.url }, "AI planning failed unexpectedly");
      emit(input, {
        runId: context.runId,
        type: "ai.planning_failed",
        status: "failed",
        message,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        diagnostics: serializeError(error),
      });
      const pageReport: PageReport = {
        url: snapshot.url,
        canonicalUrl: snapshot.canonicalUrl,
        stateFingerprint: snapshot.stateFingerprint,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        direction: context.direction,
        status: summarizePageStatus([...baselineResults, ...linkHealthResults]),
        tests: [...baselineResults, ...linkHealthResults],
        consoleErrors: snapshot.consoleErrors,
        failedNetworkRequests: snapshot.failedRequests,
        performanceObservations: snapshot.performance,
        evidence: pageEvidence,
        skippedReason: `AI test-case planning failed: ${message}`,
      };
      this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, 0, navigationMs);
      await this.writePageReportArtifact(input.artifacts, context, pageReport, input.events);
      return { report: pageReport, snapshot };
    }

    // Phase 4: planned cases are now executed and judged against §6, so they
    // legitimately count toward testsExecuted. `plannedTestCases` still
    // records what was planned, including anything execution could not reach.
    const executedResults: TestCaseResult[] = [];
    for (const testCase of planResult.testCases) {
      const form = formsByFormId.get(testCase.formId);
      if (!form) continue;
      emit(input, {
        runId: context.runId,
        type: "test_case.started",
        status: "started",
        message: `Executing form test case: ${testCase.intent}.`,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        formTestCase: {
          runId: context.runId,
          caseId: testCase.caseId,
          formId: testCase.formId,
          pageUrl: snapshot.url,
          role: context.roleName,
          viewport: context.viewportName,
          locale: context.localeName,
          planningSource: normalizePlanningSource(planResult.source),
          testCase,
          status: "running",
          submit: testCase.submit,
        },
      });
      const result = await executeFormTestCase({
        page: session.page,
        testCase,
        target: { form, softBlockedSignal: softBlockedByFormId.get(testCase.formId) },
        elementMap: new Map(snapshot.elements.map((element) => [element.id, element])),
        allowFormSubmission: context.request.execution.allowFormSubmission,
        screenshotOnFailure: (page, name, description) => input.evidenceCollector.screenshotOnFailure(page, name, description),
        runId: context.runId,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        planningSource: normalizePlanningSource(planResult.source),
        onEvent: input.events,
        control: context.control,
        extendDeadlineMs: (milliseconds) => {
          context.deadlineMs += milliseconds;
        },
      });
      executedResults.push(result);
      emit(input, {
        runId: context.runId,
        type: result.status === "PASSED" ? "test_case.passed" : "test_case.failed",
        status: result.status === "PASSED" ? "passed" : result.status === "INCONCLUSIVE" ? "skipped" : "failed",
        message: result.actualResult ?? result.name,
        pageUrl: snapshot.url,
        role: context.roleName,
        viewport: context.viewportName,
        locale: context.localeName,
        formTestCase: {
          runId: context.runId,
          caseId: testCase.caseId,
          formId: testCase.formId,
          pageUrl: snapshot.url,
          role: context.roleName,
          viewport: context.viewportName,
          locale: context.localeName,
          planningSource: normalizePlanningSource(planResult.source),
          testCase,
          status: result.status === "PASSED" ? "passed" : result.status === "INCONCLUSIVE" ? "inconclusive" : "failed",
          submit: testCase.submit,
          selectedButton: result.reproductionSteps.find((step) => step.startsWith("Click "))?.replace(/^Click /, ""),
          resultStatus: result.status,
          resultMessage: result.actualResult,
        },
      });
      // Reload unconditionally between cases. A URL comparison is not enough:
      // a form posting to its own path leaves the URL identical while
      // replacing the DOM with a confirmation page, after which every later
      // case fills fields that no longer exist and reports INCONCLUSIVE.
      // Cases must be independent, and that means a known starting state.
      await session.page.goto(snapshot.url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }

    const testResults: TestCaseResult[] = [...baselineResults, ...linkHealthResults, ...blockedResults, ...executedResults];
    const pageReport: PageReport = {
      url: snapshot.url,
      canonicalUrl: snapshot.canonicalUrl,
      stateFingerprint: snapshot.stateFingerprint,
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
      direction: context.direction,
      status: summarizePageStatus(testResults),
      tests: testResults,
      consoleErrors: snapshot.consoleErrors,
      failedNetworkRequests: snapshot.failedRequests,
      performanceObservations: snapshot.performance,
      evidence: pageEvidence,
      plannedTestCases: planResult.testCases.length > 0 ? planResult.testCases : undefined,
      planningSource: normalizePlanningSource(planResult.source),
    };
    this.recordPageDiagnostics(context, pageReport, snapshot, baselineResults.length, planResult.testCases.length, navigationMs);
    await this.writePageReportArtifact(input.artifacts, context, pageReport, input.events);
    return { report: pageReport, snapshot };
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
      stateFingerprint: snapshot.stateFingerprint,
      role: context.roleName,
      viewport: context.viewportName,
      locale: context.localeName,
      direction: context.direction,
      status: pageReport.status,
      navigationMs,
      links: snapshot.links.length,
      internalLinks,
      forms: snapshot.forms.length,
      buttons,
      inputs,
      consoleErrors: snapshot.consoleErrors.length,
      networkFailures: snapshot.failedRequests.length,
      apiCalls: snapshot.observedApiCalls.length,
      images: snapshot.images.length,
      scripts: snapshot.scripts.length,
      baselineTests,
      aiPlannedTests,
    });
  }

  private recordAuthorizationDiagnostics(context: RunContext): void {
    const roles = unique(context.pageReports.map((page) => page.role).filter(Boolean) as string[]);
    if (roles.length < 2) return;

    const reportsByRole = new Map<string, PageReport[]>();
    for (const role of roles) {
      reportsByRole.set(role, context.pageReports.filter((page) => page.role === role));
    }

    const baselineRole = roles[0];
    if (!baselineRole) return;
    const baselineReports = reportsByRole.get(baselineRole) ?? [];
    const baselineUrls = new Set(baselineReports.map((page) => page.canonicalUrl));
    const baselineElements = new Set(
      baselineReports.flatMap((page) =>
        page.tests.flatMap((test) => test.reproductionSteps).filter((step) => step.includes("Inspect page snapshot")),
      ),
    );

    for (const role of roles.slice(1)) {
      const reports = reportsByRole.get(role) ?? [];
      const urls = new Set(reports.map((page) => page.canonicalUrl));
      const uniqueUrls = [...urls].filter((url) => !baselineUrls.has(url)).slice(0, 20);
      const sharedUrls = [...urls].filter((url) => baselineUrls.has(url)).length;
      const status = uniqueUrls.length > 0 ? "INCONCLUSIVE" : "PASSED";
      context.diagnostics.authorization?.comparisons.push({
        role,
        comparedTo: baselineRole,
        sharedUrls,
        uniqueUrls,
        uniqueElements: baselineElements.size,
        status,
        message:
          uniqueUrls.length > 0
            ? `${role} reached ${uniqueUrls.length} URL(s) not reached by ${baselineRole}; review expected RBAC differences.`
            : `${role} did not expose extra crawled URLs compared with ${baselineRole}.`,
      });
    }
  }

  private async writePageReportArtifact(
    artifacts: ArtifactManager,
    context: RunContext,
    pageReport: PageReport,
    events?: RunEventSink,
  ): Promise<void> {
    try {
      const runId = context.runId;
      const pageNumber = context.pageReports.length + 1;
      const evidence = await artifacts.writeJson(
        "reports",
        `page-${String(pageNumber).padStart(6, "0")}-${crypto.randomUUID().slice(0, 8)}.json`,
        pageReport,
      );
      pageReport.evidence.push({
        ...evidence,
        description: "Per-page report generated immediately after page testing.",
      });
      const pageDiagnostic = context.diagnostics.pages.find((page) => page.url === pageReport.url);
      if (pageDiagnostic) {
        pageDiagnostic.reportArtifactPath = evidence.path;
      }
      await this.history.checkpointPage(runId, evidence.path, [...context.pageReports, pageReport]);
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
      emit({ events }, {
        runId,
        type: "page.report_written",
        status: "passed",
        message: "Per-page report artifact generated.",
        pageUrl: pageReport.url,
        role: pageReport.role,
        viewport: pageReport.viewport,
        locale: pageReport.locale,
        counts: {
          tests: pageReport.tests.length,
          issues: pageReport.tests.filter((test) => test.status === "FAILED" || test.status === "ERROR").length,
        },
      });
    } catch (error) {
      logger.warn(
        { err: redactSecrets(error), runId: context.runId, url: pageReport.url },
        "Failed to write per-page report artifact",
      );
      throw new AppError({
        code: ERROR_CODES.REPORT_GENERATION_FAILURE,
        message: `Failed to persist the per-page report for ${pageReport.url}.`,
        statusCode: 500,
        details: serializeError(error),
        fatal: true,
      });
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
    events?: RunEventSink;
  }): Promise<TestCaseResult> {
    const steps: TestStepResult[] = [];
    const assertions: TestStepResult[] = [];
    const reproductionSteps: string[] = [];
    emit(input, {
      runId: input.context.runId,
      type: "test_case.started",
      status: "started",
      message: `Executing test case: ${input.testCase.name}.`,
      pageUrl: safePageUrl(input.session.page),
      role: input.context.roleName,
      viewport: input.context.viewportName,
      locale: input.context.localeName,
    });

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
        emit(input, {
          runId: input.context.runId,
          type: "test_case.failed",
          status: step.status === "BLOCKED_BY_POLICY" ? "blocked" : "failed",
          message: step.error ?? `${input.testCase.name} did not pass.`,
          pageUrl: safePageUrl(input.session.page),
          role: input.context.roleName,
          viewport: input.context.viewportName,
          locale: input.context.localeName,
          diagnostics: step,
        });
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
    emit(input, {
      runId: input.context.runId,
      type: failedAssertion ? "test_case.failed" : "test_case.passed",
      status: failedAssertion ? "failed" : "passed",
      message: failedAssertion?.error ?? `Test case passed: ${input.testCase.name}.`,
      pageUrl: safePageUrl(input.session.page),
      role: input.context.roleName,
      viewport: input.context.viewportName,
      locale: input.context.localeName,
      diagnostics: failedAssertion,
    });

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

function normalizePlanningSource(source: FormPlanResult["source"]): "ai" | "deterministic" | "mixed" {
  return source === "none" ? "deterministic" : source;
}

function emit(input: { onEvent?: RunEventSink; events?: RunEventSink }, event: RunProgressEventInput): void {
  const sink = input.onEvent ?? input.events;
  if (sink) sink(event);
}

function emitAiDiagnostics(input: { onEvent?: RunEventSink; events?: RunEventSink }, context: RunContext): void {
  const diagnostics = {
    provider: context.diagnostics.ai.provider,
    providerConfigured: context.diagnostics.ai.providerConfigured,
    maxCalls: context.diagnostics.ai.maxCalls,
    disabled: context.diagnostics.ai.disabled,
  };

  if (context.diagnostics.ai.disabled) {
    emit(input, {
      runId: context.runId,
      type: "ai:disabled",
      status: "skipped",
      message: "AI planning is disabled because the AI call budget for this run is 0.",
      diagnostics,
    });
    return;
  }

  if (!context.diagnostics.ai.providerConfigured) {
    emit(input, {
      runId: context.runId,
      type: "ai:configuration-missing",
      status: "skipped",
      message: "OpenRouter is not fully configured, so AI planning may be skipped while deterministic tests continue.",
      diagnostics,
    });
    return;
  }

  emit(input, {
    runId: context.runId,
    type: "ai:enabled",
    status: "info",
    message: `AI planning is enabled with a per-run budget of ${context.diagnostics.ai.maxCalls} call(s).`,
    diagnostics,
  });
}

async function prepareFormsForAiPlanning(input: {
  context: RunContext;
  session: BrowserSession;
  events?: RunEventSink;
}, page: Page, snapshot: PageSnapshot): Promise<void> {
  const forms = snapshot.forms.filter((form) =>
    [...form.fields, ...form.submitControls].some((element) => !element.hidden),
  );
  const fieldCount = forms.reduce((sum, form) => sum + form.fields.filter((field) => !field.hidden).length, 0);
  emit(input, {
    runId: input.context.runId,
    type: "form:discovered",
    status: forms.length > 0 ? "passed" : "skipped",
    message: forms.length > 0
      ? `Discovered ${forms.length} visible form(s) with ${fieldCount} visible input field(s).`
      : "No visible forms were discovered for AI form planning.",
    pageUrl: snapshot.url,
    role: input.context.roleName,
    viewport: input.context.viewportName,
    locale: input.context.localeName,
    counts: { forms: forms.length, fields: fieldCount },
  });

  for (const form of forms) {
    const anchor = snapshot.elements.find((element) => element.id === form.elementId && !element.hidden)
      ?? form.fields.find((field) => !field.hidden)
      ?? form.submitControls.find((control) => !control.hidden);
    if (!anchor) continue;
    emit(input, {
      runId: input.context.runId,
      type: "form:scanning",
      status: "started",
      message: `Scrolling form ${form.elementId} into view before AI planning.`,
      pageUrl: snapshot.url,
      role: input.context.roleName,
      viewport: input.context.viewportName,
      locale: input.context.localeName,
      counts: {
        fields: form.fields.filter((field) => !field.hidden).length,
        submitControls: form.submitControls.filter((control) => !control.hidden).length,
      },
    });
    await locatorFromDescriptor(page, anchor.locator).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);
    await emitLiveFrame(input, page, `Form ${form.elementId} frame.`);
    emit(input, {
      runId: input.context.runId,
      type: "form:ready-for-ai",
      status: "passed",
      message: `Form ${form.elementId} is visible and ready for AI input-list planning.`,
      pageUrl: snapshot.url,
      role: input.context.roleName,
      viewport: input.context.viewportName,
      locale: input.context.localeName,
      counts: {
        fields: form.fields.filter((field) => !field.hidden).length,
        submitControls: form.submitControls.filter((control) => !control.hidden).length,
      },
    });
  }
}

async function emitLiveFrame(input: {
  context: RunContext;
  session: BrowserSession;
  events?: RunEventSink;
}, page: Page, message: string): Promise<void> {
  if (!config.liveView.enabled || input.context.request.visualizationMode !== "live") return;
  try {
    const buffer = await withCursorSuppressed(page, () => page.screenshot({ type: "jpeg", quality: 55, timeout: 5000 }));
    emit(input, {
      runId: input.context.runId,
      type: "live-view:frame",
      status: "info",
      message,
      pageUrl: safePageUrl(page),
      role: input.context.roleName,
      viewport: input.context.viewportName,
      locale: input.context.localeName,
      liveFrame: {
        mimeType: "image/jpeg",
        data: buffer.toString("base64"),
        pageUrl: safePageUrl(page),
      },
    });
  } catch {
    // Live view is best-effort and must not fail test execution.
  }
}

function safePageUrl(page: Page): string | undefined {
  try {
    return typeof page.url === "function" ? page.url() : undefined;
  } catch {
    return undefined;
  }
}

async function capturePageEvidence(input: {
  artifacts: ArtifactManager;
  page: Page;
  context: RunContext;
  snapshot: PageSnapshot;
}) {
  try {
    const slug = [
      input.context.runId,
      input.context.roleName ?? "default",
      input.context.viewportName ?? "viewport",
      input.context.localeName ?? "locale",
      input.snapshot.canonicalUrl.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80),
    ].join("-");
    return [
      await input.artifacts.screenshot(
        input.page,
        slug,
        `Page screenshot for ${input.context.roleName ?? "default"} ${input.context.viewportName ?? "default"} ${input.context.localeName ?? "default"}.`,
      ),
    ];
  } catch {
    return [];
  }
}

function cloneCredentials(credentials?: TestingRunRequest["credentials"]): TestingRunRequest["credentials"] {
  return credentials
    ? {
        ...credentials,
        fieldHints: credentials.fieldHints ? { ...credentials.fieldHints } : undefined,
      }
    : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function traceFileName(...parts: string[]): string {
  return `${parts.join("-").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160)}.zip`;
}

function clampOptionalLimit(requested: number | undefined, emergencyLimit: number): number | undefined {
  if (requested === undefined) return emergencyLimit;
  return Math.min(requested, emergencyLimit);
}

/**
 * DESIGN-DECISIONS.md §9: whichever budget trips first wins. Across matrix
 * targets the most severe reason survives, so a later target that converged
 * can never mask an earlier one that ran out of time or was stopped.
 */
const STOPPED_REASON_PRECEDENCE: StoppedReason[] = [
  "error",
  "user_stopped",
  "time_budget",
  "page_budget",
  "depth_budget",
  "converged",
];

/**
 * Folds a matrix target's own stoppedReason into the run-level one, most
 * severe wins. Exported for direct testing: the bug this prevents (a
 * time-limited target aggregating to `converged`) is invisible from the
 * outside until a whole matrix run is driven end to end.
 */
export function mergeStoppedReason(current: StoppedReason | undefined, incoming: StoppedReason | undefined): StoppedReason | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentRank = STOPPED_REASON_PRECEDENCE.indexOf(current);
  const incomingRank = STOPPED_REASON_PRECEDENCE.indexOf(incoming);
  return incomingRank < currentRank ? incoming : current;
}

/**
 * A hard-blocked form (§4) is recorded rather than silently omitted — the run
 * must be able to say which forms it deliberately did not test, and why.
 * INFO per §8's "skipped or blocked forms" row.
 */
function blockedFormResult(formId: string, elementId: string, matchedSignal: string, pageUrl: string): TestCaseResult {
  return {
    id: `form-blocked-${formId.slice(0, 8)}`,
    name: `Privileged form not tested (${matchedSignal})`,
    type: "FORMS",
    status: "SKIPPED",
    steps: [],
    assertions: [],
    expectedResult: "Form is eligible for safe automated testing.",
    actualResult: `Blocked by the privileged-form classifier: ${matchedSignal}.`,
    evidence: [],
    reproductionSteps: [`Open ${pageUrl}`, `Inspect form ${elementId}`],
    severity: severityForInformational("form_blocked"),
    confidence: 1,
  };
}

/** Pulls the full provider attempt history off an OpenRouterClient exhaustion error, when present. */
function extractLlmAttempts(error: unknown): LlmAttempt[] | undefined {
  if (!(error instanceof AppError)) return undefined;
  const details = error.details;
  if (!details || typeof details !== "object" || !("attempts" in details)) return undefined;
  const attempts = (details as { attempts: unknown }).attempts;
  return Array.isArray(attempts) ? (attempts as LlmAttempt[]) : undefined;
}
