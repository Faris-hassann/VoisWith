import { describe, expect, it } from "vitest";
import { AiContextBuilder } from "../../src/ai/ai-context-builder.js";
import type { RunContext } from "../../src/testing/run-context.js";
import type { ElementInventoryItem, PageSnapshot, TestingRunRequest } from "../../src/types/testing.js";

describe("AiContextBuilder", () => {
  it("sends a sanitized form input list without locators or broad page snapshot data", () => {
    const field = element("element_2", "input", {
      label: "Email",
      name: "email",
      type: "email",
      required: true,
      formOwnerElementId: "element_1",
    });
    const submit = element("element_3", "submit", {
      text: "Send",
      formOwnerElementId: "element_1",
    });
    const snapshot: PageSnapshot = {
      url: "https://example.com/contact",
      canonicalUrl: "https://example.com/contact",
      stateFingerprint: "state_1",
      title: "Contact",
      headings: ["Contact us"],
      landmarks: ["main"],
      visibleText: "This full visible text must not be sent to AI.",
      links: [],
      images: [{ src: "https://example.com/logo.png", internal: true }],
      scripts: [{ src: "https://example.com/app.js", internal: true }],
      elements: [element("element_1", "form", { tagName: "form" }), field, submit],
      forms: [
        {
          elementId: "element_1",
          method: "post",
          action: "https://example.com/contact",
          fields: [field],
          submitControls: [submit],
          apparentPurpose: "contact",
        },
      ],
      tables: ["table data"],
      dialogs: [],
      currentQueryParameters: {},
      consoleErrors: [],
      failedRequests: [],
      observedApiCalls: [],
      performance: [],
      visibleValidationErrors: [],
      uiObservations: [],
    };

    const payload = new AiContextBuilder().build(contextFor(), snapshot) as {
      page: {
        visibleText?: string;
        elements?: unknown[];
        images?: unknown[];
        scripts?: unknown[];
        forms: Array<{
          formId: string;
          fields: Array<{ elementId: string; label?: string; locator?: unknown; valuePlaceholder?: string }>;
          submitControls: Array<{ elementId: string; locator?: unknown }>;
        }>;
      };
    };

    expect(payload.page.visibleText).toBeUndefined();
    expect(payload.page.elements).toBeUndefined();
    expect(payload.page.images).toBeUndefined();
    expect(payload.page.scripts).toBeUndefined();
    expect(payload.page.forms).toHaveLength(1);
    expect(payload.page.forms[0]?.formId).toBe("element_1");
    expect(payload.page.forms[0]?.fields[0]).toMatchObject({
      elementId: "element_2",
      label: "Email",
      valuePlaceholder: "VALID_EMAIL",
    });
    expect(payload.page.forms[0]?.fields[0]?.locator).toBeUndefined();
    expect(payload.page.forms[0]?.submitControls[0]?.locator).toBeUndefined();
  });
});

function contextFor(): RunContext {
  const request: TestingRunRequest = {
    targetUrl: "https://example.com/contact",
    authorizationConfirmed: true,
    environment: "production",
    testTypes: ["FORMS", "FORM_VALIDATION"],
    crawl: { strategy: "DFS", sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
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
    runId: "run_ai_context",
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
      runId: "run_ai_context",
      targetUrl: request.targetUrl,
      startedAt: new Date().toISOString(),
      browser: { launched: true },
      login: { status: "SKIPPED", message: "No credentials supplied." },
      crawl: { acceptedUrls: [], skippedUrls: [], failedUrls: [], discoveredCandidates: 0, noInternalLinksPages: [], events: [] },
      pages: [],
      ai: { calls: 0, maxCalls: 50, disabled: false, openRouterConfigured: true, modelConfigured: true, successes: 0, failures: [], validationFailures: [] },
    },
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
