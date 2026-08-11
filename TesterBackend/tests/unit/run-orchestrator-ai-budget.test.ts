import { describe, expect, it } from "vitest";
import { RunOrchestrator } from "../../src/services/run-orchestrator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { PageSnapshot, TestingRunRequest } from "../../src/types/testing.js";

describe("RunOrchestrator AI budget behavior", () => {
  it("still inspects a formless page and returns baseline tests plus snapshot links when AI budget is exhausted", async () => {
    const orchestrator = new RunOrchestrator();
    const snapshot = snapshotFor("https://example.com/dashboard");
    let plannerCalled = false;
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () => snapshot,
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        throw new Error("planner should not be called");
      },
    };

    const result = await orchestrator["testPage"]({
      context: contextFor(),
      session: {
        page: {
          goto: async () => undefined,
          url: () => "https://example.com/dashboard",
          screenshot: async () => undefined,
        },
      },
      url: "https://example.com/dashboard",
      consoleCollector: { all: () => [] },
      networkCollector: { failed: () => [], apiCalls: () => [] },
      performanceCollector: { collect: async () => [] },
      evidenceCollector: { screenshotOnFailure: async () => [] },
      artifacts: {
        writeJson: async () => ({ id: "report", type: "report", path: "report.json" }),
      },
    } as never);

    expect(plannerCalled).toBe(false);
    expect(result.snapshot.links).toHaveLength(1);
    expect(result.report.tests.some((test) => test.id === "baseline-smoke")).toBe(true);
    expect(result.report.tests.some((test) => test.id === "ai-form-submission-scope" && test.status === "SKIPPED")).toBe(true);
  });
});

function contextFor(): RunContext {
  const request: TestingRunRequest = {
    targetUrl: "https://example.com/dashboard",
    authorizationConfirmed: true,
    environment: "production",
    testTypes: ["SMOKE", "PAGE_DISCOVERY"],
    crawl: { strategy: "DFS", maxDepth: 8, maxPages: 50, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 15,
      maximumRunDurationSeconds: 1800,
    },
  };
  return {
    runId: "run_ai_budget",
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
    aiCalls: 999,
    deadlineMs: Date.now() + 60_000,
    artifactRoot: "",
    diagnostics: {
      runId: "run_ai_budget",
      targetUrl: request.targetUrl,
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 999, maxCalls: 999, disabled: false, providerConfigured: true, successes: 0, failures: [], validationFailures: [], recoveredAttempts: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
    },
  };
}

function snapshotFor(url: string): PageSnapshot {
  return {
    url,
    canonicalUrl: url,
    title: "Dashboard",
    headings: ["Dashboard"],
    visibleText: "Dashboard",
    links: [
      {
        text: "Next",
        href: "https://example.com/forms",
        canonicalHref: "https://example.com/forms",
        internal: true,
      },
    ],
    images: [],
    scripts: [],
    elements: [],
    forms: [],
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
