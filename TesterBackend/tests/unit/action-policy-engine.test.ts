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
});
