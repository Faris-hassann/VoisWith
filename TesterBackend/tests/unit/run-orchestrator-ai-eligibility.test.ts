import { describe, expect, it } from "vitest";
import { RunOrchestrator } from "../../src/services/run-orchestrator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { ElementInventoryItem, PageSnapshot, TestingRunRequest } from "../../src/types/testing.js";

describe("RunOrchestrator AI eligibility", () => {
  it("skips the AI planner for static pages without form or submission targets", async () => {
    const orchestrator = new RunOrchestrator();
    let plannerCalled = false;
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () => snapshotFor("https://example.com/about"),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        return { pageSummary: "", identifiedPurpose: "", risks: [], testCases: [], additionalLinksToPrioritize: [], pageTestingComplete: true };
      },
    };

    const result = await testPage(orchestrator, contextFor());

    expect(plannerCalled).toBe(false);
    expect(result.report.tests.some((test) => test.id === "ai-form-submission-scope" && test.status === "SKIPPED")).toBe(true);
  });

  it("calls the AI planner for form and login-like pages", async () => {
    const orchestrator = new RunOrchestrator();
    let plannerCalled = false;
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () =>
        snapshotFor("https://example.com/login", [
          element("email", "input", { type: "email", placeholder: "Email" }),
          element("password", "input", { type: "password", placeholder: "Password" }),
          element("submit", "submit", { text: "Sign in" }),
        ]),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        return { pageSummary: "Login", identifiedPurpose: "Login", risks: [], testCases: [], additionalLinksToPrioritize: [], pageTestingComplete: true };
      },
    };

    await testPage(orchestrator, contextFor());

    expect(plannerCalled).toBe(true);
  });
});

async function testPage(orchestrator: RunOrchestrator, context: RunContext) {
  return orchestrator["testPage"]({
    context,
    session: {
      page: {
        goto: async () => undefined,
        url: () => context.request.targetUrl,
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
    targetUrl: "https://example.com/about",
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
    runId: "run_ai_eligibility",
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
      runId: "run_ai_eligibility",
      targetUrl: request.targetUrl,
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 0, successes: 0, failures: [], validationFailures: [] },
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
