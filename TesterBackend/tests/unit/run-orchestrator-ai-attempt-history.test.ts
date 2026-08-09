import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/app-error.js";
import { ERROR_CODES, LLM_FAILURE_REASONS } from "../../src/errors/error-codes.js";
import { buildInspectedForms } from "../../src/inspection/page-inspector.js";
import { RunOrchestrator } from "../../src/services/run-orchestrator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { ElementInventoryItem, PageSnapshot, TestingRunRequest } from "../../src/types/testing.js";

/**
 * Regression coverage for the diagnostic blind spot found while investigating
 * "AI planning failed for at least one page": the full per-model attempt
 * history from openrouter-client.ts must survive into
 * diagnostics.ai.failures, not just the last model's reason.
 */
describe("RunOrchestrator AI failure attempt history", () => {
  it("carries the full per-model attempt breakdown into diagnostics.ai.failures", async () => {
    const orchestrator = new RunOrchestrator();
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () =>
        snapshotFor("https://example.com/login", [
          element("element_1", "form", { tagName: "form" }),
          element("element_2", "input", { type: "email", placeholder: "Email", formOwnerElementId: "element_1" }),
          element("element_3", "submit", { text: "Sign in", formOwnerElementId: "element_1" }),
        ]),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        throw new AppError({
          code: ERROR_CODES.AI_REQUEST_FAILURE,
          message: "OpenRouter request failed on all 3 configured models: Model c truncated its response.",
          statusCode: 502,
          llmFailureReason: LLM_FAILURE_REASONS.LLM_TRUNCATED,
          details: {
            attempts: [
              { model: "vendor-a/model-a:free", reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: "Model a truncated." },
              { model: "vendor-b/model-b:free", reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED, message: "Model b rate limited." },
              { model: "vendor-c/model-c:free", reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: "Model c truncated." },
            ],
            reason: LLM_FAILURE_REASONS.LLM_TRUNCATED,
            model: "vendor-c/model-c:free",
          },
        });
      },
    };

    const context = contextFor();
    await testPage(orchestrator, context);

    expect(context.diagnostics.ai.failures).toHaveLength(1);
    const failure = context.diagnostics.ai.failures[0]!;
    expect(failure.reason).toBe(LLM_FAILURE_REASONS.LLM_TRUNCATED);
    expect(failure.attempts).toEqual([
      { model: "vendor-a/model-a:free", reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: "Model a truncated." },
      { model: "vendor-b/model-b:free", reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED, message: "Model b rate limited." },
      { model: "vendor-c/model-c:free", reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: "Model c truncated." },
    ]);
  });

  it("leaves attempts undefined when the thrown error carries no attempt history", async () => {
    const orchestrator = new RunOrchestrator();
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () =>
        snapshotFor("https://example.com/login", [
          element("element_1", "form", { tagName: "form" }),
          element("element_2", "input", { type: "email", placeholder: "Email", formOwnerElementId: "element_1" }),
          element("element_3", "submit", { text: "Sign in", formOwnerElementId: "element_1" }),
        ]),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        throw new Error("Unexpected non-AppError failure.");
      },
    };

    const context = contextFor();
    await testPage(orchestrator, context);

    expect(context.diagnostics.ai.failures).toHaveLength(1);
    expect(context.diagnostics.ai.failures[0]!.attempts).toBeUndefined();
  });
});

async function testPage(orchestrator: RunOrchestrator, context: RunContext) {
  return orchestrator["testPage"]({
    context,
    session: {
      page: {
        goto: async () => undefined,
        url: () => context.request.targetUrl,
        locator: () => ({ first: () => ({ scrollIntoViewIfNeeded: async () => undefined }) }),
        waitForTimeout: async () => undefined,
        screenshot: async () => undefined,
      },
    },
    url: context.request.targetUrl,
    consoleCollector: { all: () => [] },
    networkCollector: { failed: () => [], apiCalls: () => [] },
    performanceCollector: { collect: async () => [] },
    evidenceCollector: { screenshotOnFailure: async () => [] },
    artifacts: {
      writeJson: async () => ({ id: "report", type: "report", path: "report.json" }),
    },
  } as never);
}

function contextFor(): RunContext {
  const request: TestingRunRequest = {
    targetUrl: "https://example.com/login",
    authorizationConfirmed: true,
    environment: "production",
    testTypes: ["SMOKE", "FORMS"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 5,
      maximumRunDurationSeconds: 60,
    },
  };
  return {
    runId: "run_ai_attempt_history",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request,
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
      runId: "run_ai_attempt_history",
      targetUrl: request.targetUrl,
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 0, maxCalls: 25, disabled: false, openRouterConfigured: true, modelConfigured: true, successes: 0, failures: [], validationFailures: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
    },
  };
}

function snapshotFor(url: string, elements: ElementInventoryItem[] = []): PageSnapshot {
  return {
    url,
    canonicalUrl: url,
    title: "Page",
    headings: ["Page"],
    visibleText: "Page",
    links: [],
    images: [],
    scripts: [],
    elements,
    forms: buildInspectedForms(elements),
    tables: [],
    dialogs: [],
    currentQueryParameters: {},
    consoleErrors: [],
    failedRequests: [],
    observedApiCalls: [],
    performance: [],
    visibleValidationErrors: [],
    uiObservations: [],
  };
}

function element(
  id: string,
  kind: ElementInventoryItem["kind"],
  overrides: Partial<ElementInventoryItem> = {},
): ElementInventoryItem {
  return {
    id,
    kind,
    tagName: kind === "submit" ? "button" : "input",
    disabled: false,
    hidden: false,
    locator: { strategy: "css", value: `#${id}` },
    ...overrides,
  };
}
