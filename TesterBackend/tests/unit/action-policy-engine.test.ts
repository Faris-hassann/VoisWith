import { describe, expect, it } from "vitest";
import { ActionPolicyEngine } from "../../src/actions/action-policy-engine.js";

describe("ActionPolicyEngine", () => {
  it("blocks destructive safe-mode actions", () => {
    const engine = new ActionPolicyEngine();
    const decision = engine.decide({
      action: { action: "CLICK", elementId: "element_1", description: "Delete account" },
      testCase: {
        id: "t1",
        name: "Delete account",
        type: "SMOKE",
        priority: "HIGH",
        preconditions: [],
        steps: [],
        assertions: [],
        cleanupActions: [],
        destructive: true,
        reasoningSummary: "delete",
      },
      request: {
        targetUrl: "https://example.com",
        authorizationConfirmed: true,
        testTypes: ["SMOKE"],
        crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
        browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
        execution: {
          safeMode: true,
          allowFormSubmission: true,
          allowFileUploads: true,
          allowDestructiveActions: false,
          allowPayments: false,
          maximumActionsPerPage: 40,
          maximumRunDurationSeconds: 900,
        },
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("BLOCKED_BY_POLICY");
  });

  it("requires staging for sensitive submissions", () => {
    const engine = new ActionPolicyEngine();
    const decision = engine.decide({
      action: { action: "SUBMIT", elementId: "element_1", description: "Submit ticket" },
      testCase: {
        id: "t2",
        name: "Create ticket",
        type: "FORMS",
        priority: "HIGH",
        preconditions: [],
        steps: [],
        assertions: [],
        cleanupActions: [],
        destructive: false,
        reasoningSummary: "ticket submission",
      },
      request: {
        targetUrl: "https://example.com",
        authorizationConfirmed: true,
        environment: "production",
        testTypes: ["FORMS"],
        crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
        browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
        execution: {
          safeMode: true,
          allowFormSubmission: true,
          allowFileUploads: true,
          allowDestructiveActions: false,
          allowPayments: false,
          maximumActionsPerPage: 40,
          maximumRunDurationSeconds: 900,
        },
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("environment=staging");
  });

  it("allows safe field entry even when the field is an email input", () => {
    const engine = new ActionPolicyEngine();
    const decision = engine.decide({
      action: { action: "FILL", elementId: "element_1", valueStrategy: "VALID_EMAIL", description: "Enter valid email" },
      element: {
        id: "element_1",
        kind: "input",
        tagName: "input",
        label: "Email",
        name: "email",
        type: "email",
        disabled: false,
        hidden: false,
        locator: { strategy: "label", value: "Email" },
      },
      testCase: {
        id: "t3",
        name: "Validation: Invalid Email Format",
        type: "FORM_VALIDATION",
        priority: "HIGH",
        preconditions: [],
        steps: [],
        assertions: [],
        cleanupActions: [],
        destructive: false,
        reasoningSummary: "Safe email field validation.",
      },
      request: {
        targetUrl: "https://example.com",
        authorizationConfirmed: true,
        testTypes: ["FORMS", "FORM_VALIDATION"],
        crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
        browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
        execution: {
          safeMode: true,
          allowFormSubmission: false,
          allowFileUploads: false,
          allowDestructiveActions: false,
          allowPayments: false,
          maximumActionsPerPage: 40,
          maximumRunDurationSeconds: 900,
        },
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.status).toBe("APPROVED");
  });
});
