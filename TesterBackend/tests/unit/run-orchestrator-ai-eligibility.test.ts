import { describe, expect, it } from "vitest";
import { buildFormSnapshots } from "../../src/ai/form-snapshot-builder.js";
import { buildInspectedForms } from "../../src/inspection/page-inspector.js";
import { RunOrchestrator } from "../../src/services/run-orchestrator.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { ElementInventoryItem, PageSnapshot, TestingRunRequest } from "../../src/types/testing.js";

describe("RunOrchestrator AI eligibility", () => {
  it("skips the AI planner for pages with no visible form inputs", async () => {
    const orchestrator = new RunOrchestrator();
    let plannerCalled = false;
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () => snapshotFor("https://example.com/about"),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        return { testCases: [], source: "none", batchesPlanned: 0, batchesFallenBack: 0, fallbackFailures: [] };
      },
    };

    const result = await testPage(orchestrator, contextFor());

    expect(plannerCalled).toBe(false);
    expect(result.report.tests.some((test) => test.id === "ai-form-submission-scope")).toBe(true);
    expect(result.report.skippedReason).toBe("AI planning requires at least one visible form input.");
  });

  it("calls the AI planner for form and login-like pages", async () => {
    const orchestrator = new RunOrchestrator();
    let plannerCalled = false;
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () =>
        snapshotFor("https://example.com/login", [
          element("element_1", "form", { tagName: "form" }),
          element("element_2", "input", { type: "email", placeholder: "Email", formOwnerElementId: "element_1" }),
          element("element_3", "input", { type: "password", placeholder: "Password", formOwnerElementId: "element_1" }),
          element("element_4", "submit", { text: "Sign in", formOwnerElementId: "element_1" }),
        ]),
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        return { testCases: [], source: "none", batchesPlanned: 0, batchesFallenBack: 0, fallbackFailures: [] };
      },
    };

    await testPage(orchestrator, contextFor());

    expect(plannerCalled).toBe(true);
  });

  it("skips AI planning when every discovered form is already blocked or duplicate", async () => {
    const orchestrator = new RunOrchestrator();
    let plannerCalled = false;
    const contactSnapshot = snapshotFor("https://example.com/contact", [
      element("element_11", "form", { tagName: "form" }),
      element("element_12", "input", { name: "name", required: true, formOwnerElementId: "element_11" }),
      element("element_13", "input", { name: "email", type: "email", formOwnerElementId: "element_11" }),
      element("element_14", "submit", { text: "Send", formOwnerElementId: "element_11" }),
      element("element_21", "form", { tagName: "form" }),
      element("element_22", "input", { name: "name", required: true, formOwnerElementId: "element_21" }),
      element("element_23", "input", { name: "email", type: "email", formOwnerElementId: "element_21" }),
      element("element_24", "submit", { text: "Send", formOwnerElementId: "element_21" }),
      element("element_31", "form", { tagName: "form" }),
      element("element_32", "input", { name: "api_key", formOwnerElementId: "element_31" }),
      element("element_33", "submit", { text: "Submit", formOwnerElementId: "element_31" }),
    ]);
    (orchestrator as never as { inspector: unknown }).inspector = {
      inspect: async () => contactSnapshot,
    };
    (orchestrator as never as { planner: unknown }).planner = {
      plan: async () => {
        plannerCalled = true;
        return { testCases: [], source: "none", batchesPlanned: 0, batchesFallenBack: 0, fallbackFailures: [] };
      },
    };

    const context = contextFor();
    const duplicateFormId = buildFormSnapshots(contactSnapshot.forms.slice(0, 2), contactSnapshot.url)[0]?.formId;
    if (!duplicateFormId) throw new Error("Expected duplicate form id");
    context.processedForms = new Map([[duplicateFormId, "https://example.com/first-page"]]);
    const events: Array<{ type: string; status: string; counts?: Record<string, number> }> = [];
    const result = await orchestrator["testPage"](testPageInput(context, events) as never);

    expect(plannerCalled).toBe(false);
    expect(result.report.skippedReason).toContain("privileged-blocked or already tested");
    expect(events.some((event) => event.type === "ai.planning_passed")).toBe(false);
    expect(events.find((event) => event.type === "ai.planning_skipped")?.counts).toEqual({
      discoveredForms: 3,
      blockedForms: 1,
      duplicateForms: 2,
      eligibleForms: 0,
    });
  });
});

async function testPage(orchestrator: RunOrchestrator, context: RunContext) {
  return orchestrator["testPage"](testPageInput(context) as never);
}

function testPageInput(context: RunContext, events?: Array<{ type: string; status: string; counts?: Record<string, number> }>) {
  return {
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
    events: (event: { type: string; status: string; counts?: Record<string, number> }) => {
      events?.push(event);
    },
  };
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
    aiCalls: 0,
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
      ai: { calls: 0, maxCalls: 50, disabled: false, providerConfigured: true, successes: 0, failures: [], validationFailures: [], recoveredAttempts: [], maxTestCases: 400, testCasesGenerated: 0, testCasesDropped: 0, deterministicFallbacks: 0 },
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
