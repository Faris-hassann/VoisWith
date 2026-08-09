import { afterEach, describe, expect, it, vi } from "vitest";

// Config is read once at module load, so pacing/model config must be in place
// before env.ts (and therefore ai-test-planner.ts) import. Per-test budget
// overrides are applied by mutating the already-parsed `config` object
// directly (see beforeEach/afterEach below) rather than re-importing modules.
process.env.OPENROUTER_API_KEY = "test-key";
process.env.OPENROUTER_MODELS = "vendor-a/model-a:free,vendor-b/model-b:free,vendor-c/model-c:free";
process.env.AI_CALL_PACING_MS = "500";

// `delay` is spied (not faked via timers) so the test doesn't have to race real
// fs I/O from PromptLoader against fake timers.
const delaySpy = vi.fn(async () => undefined);
vi.mock("../../src/utilities/timeout.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utilities/timeout.js")>("../../src/utilities/timeout.js");
  return { ...actual, delay: delaySpy };
});

const { AiTestPlanner } = await import("../../src/ai/ai-test-planner.js");
const { config } = await import("../../src/config/env.js");
const { buildInspectedForms } = await import("../../src/inspection/page-inspector.js");
const { buildFormSnapshots } = await import("../../src/ai/form-snapshot-builder.js");

const originalMaxCalls = config.limits.maxOpenRouterCallsPerRun;
const originalMaxTestCases = config.limits.maxAiTestCasesPerRun;

function emptyPlanResponse(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ testCases: [] }) }, finish_reason: "stop" }] }), {
    status: 200,
  });
}

function rateLimitedResponse(): Response {
  return new Response(null, { status: 429 });
}

describe("AiTestPlanner batching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delaySpy.mockClear();
    config.limits.maxOpenRouterCallsPerRun = originalMaxCalls;
    config.limits.maxAiTestCasesPerRun = originalMaxTestCases;
  });

  it("batches forms sequentially and paces every AI call after the first in the run", async () => {
    const fetchMock = vi.fn(async () => emptyPlanResponse());
    vi.stubGlobal("fetch", fetchMock);

    const planner = new AiTestPlanner();
    const context = contextFor();
    // 4 forms -> batches of [3, 1], so 2 sequential OpenRouter calls.
    const snapshot = snapshotWithForms(4);

    const result = await planner.plan(context, snapshot);

    expect(result.batchesPlanned).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delaySpy).toHaveBeenCalledTimes(1);
    expect(delaySpy).toHaveBeenCalledWith(config.openRouter.pacingMs);
    expect(context.openRouterCalls).toBe(2);
  });

  it("stops issuing AI calls once the call budget is reached and falls back to deterministic cases for the rest", async () => {
    config.limits.maxOpenRouterCallsPerRun = 1;
    const fetchMock = vi.fn(async () => emptyPlanResponse());
    vi.stubGlobal("fetch", fetchMock);

    const planner = new AiTestPlanner();
    const context = contextFor();
    const snapshot = snapshotWithForms(4); // batches of [3, 1]

    const result = await planner.plan(context, snapshot);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.batchesFallenBack).toBe(1);
    expect(context.diagnostics.ai.deterministicFallbacks).toBe(1);
    expect(result.source).toBe("mixed");
    expect(context.openRouterCalls).toBe(1);
  });

  it("truncates at the run-wide test-case budget without touching the call budget", async () => {
    config.limits.maxAiTestCasesPerRun = 1;
    const snapshot = snapshotWithForms(1);
    const [batch] = buildFormSnapshots(snapshot.forms, snapshot.url);
    const twoCaseResponse = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                testCases: [
                  { caseId: "c1", formId: batch!.formId, testType: "FORM_VALIDATION", intent: "a", inputs: [], submit: false, expectedOutcome: { kind: "NO_NAVIGATION" } },
                  { caseId: "c2", formId: batch!.formId, testType: "FORM_VALIDATION", intent: "b", inputs: [], submit: false, expectedOutcome: { kind: "NO_NAVIGATION" } },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200 },
    );
    vi.stubGlobal("fetch", vi.fn(async () => twoCaseResponse));

    const planner = new AiTestPlanner();
    const context = contextFor();
    const result = await planner.plan(context, snapshot);

    expect(result.testCases).toHaveLength(1);
    expect(context.diagnostics.ai.testCasesDropped).toBe(1);
    expect(context.diagnostics.ai.testCasesGenerated).toBe(1);
    expect(context.openRouterCalls).toBe(1);
  });

  it("records the full per-model attempt history and falls back to deterministic cases when a batch exhausts the model chain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rateLimitedResponse()));

    const planner = new AiTestPlanner();
    const context = contextFor();
    const snapshot = snapshotWithForms(1);

    const result = await planner.plan(context, snapshot);

    expect(result.source).toBe("deterministic");
    expect(result.testCases.length).toBeGreaterThan(0);
    expect(context.diagnostics.ai.failures).toHaveLength(1);
    expect(context.diagnostics.ai.failures[0]?.attempts).toHaveLength(3);
    expect(context.diagnostics.ai.deterministicFallbacks).toBe(1);
  });
});

function contextFor(): import("../../src/testing/run-context.js").RunContext {
  const request = {
    targetUrl: "https://example.com/contact",
    authorizationConfirmed: true as const,
    environment: "production" as const,
    testTypes: ["FORMS"] as const,
    crawl: { strategy: "DFS" as const, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome" as const, headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: true,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 5,
      maximumRunDurationSeconds: 60,
    },
  };
  return {
    runId: "run_batching",
    startedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    request: request as never,
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
      runId: "run_batching",
      targetUrl: request.targetUrl,
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: {
        calls: 0,
        maxCalls: 25,
        disabled: false,
        openRouterConfigured: true,
        modelConfigured: true,
        successes: 0,
        failures: [],
        validationFailures: [],
        maxTestCases: 400,
        testCasesGenerated: 0,
        testCasesDropped: 0,
        deterministicFallbacks: 0,
      },
    },
  } as never;
}

function snapshotWithForms(formCount: number): import("../../src/types/testing.js").PageSnapshot {
  const elements = [];
  for (let i = 0; i < formCount; i += 1) {
    // elementId must match /^element_\d+$/ — the LLM-boundary schema's shape check.
    const formId = `element_${i * 2 + 1}`;
    const fieldId = `element_${i * 2 + 2}`;
    elements.push({ id: formId, kind: "form" as const, tagName: "form", disabled: false, hidden: false, locator: { strategy: "css" as const, value: `#${formId}` } });
    elements.push({
      id: fieldId,
      kind: "input" as const,
      tagName: "input",
      type: "email",
      name: `field_${i}`,
      required: true,
      disabled: false,
      hidden: false,
      formOwnerElementId: formId,
      locator: { strategy: "css" as const, value: `#${fieldId}` },
    });
  }
  return {
    url: "https://example.com/contact",
    canonicalUrl: "https://example.com/contact",
    title: "Contact",
    headings: [],
    visibleText: "",
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
  } as never;
}
