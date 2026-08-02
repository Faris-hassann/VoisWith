import { describe, expect, it } from "vitest";
import { RunOrchestrator } from "../../src/services/run-orchestrator.js";
import type { TestCase } from "../../src/types/ai.js";
import type { ElementInventoryItem, TestingRunRequest } from "../../src/types/testing.js";

describe("RunOrchestrator AI action execution", () => {
  it("executes generated test case steps sequentially and stops on failure", async () => {
    const orchestrator = new RunOrchestrator();
    const calls: string[] = [];
    const executor = {
      execute: async (_page: unknown, action: { action: string }, _element?: unknown) => {
        calls.push(action.action);
        return {
          action,
          status: action.action === "CLICK" ? "FAILED" : "PASSED",
          error: action.action === "CLICK" ? "click failed" : undefined,
        };
      },
    };
    const result = await orchestrator["executeTestCase"]({
      context: {
        runId: "run_1",
        request: request(),
      },
      session: { page: {} },
      testCase: {
        id: "ai-1",
        name: "Generated form test",
        type: "FORMS",
        priority: "HIGH",
        preconditions: [],
        steps: [
          { action: "FILL", elementId: "element_1" },
          { action: "CLICK", elementId: "element_2" },
          { action: "WAIT_FOR", timeoutMs: 100 },
        ],
        assertions: [],
        cleanupActions: [],
        destructive: false,
        reasoningSummary: "generated",
      } satisfies TestCase,
      elementMap: new Map([
        ["element_1", element("element_1", "input")],
        ["element_2", element("element_2", "button")],
      ]),
      executor,
      assertionEngine: {},
      evidenceCollector: {
        screenshotOnFailure: async () => [],
      },
    } as never);

    expect(calls).toEqual(["FILL", "CLICK"]);
    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("click failed");
  });
});

function request(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    environment: "production",
    testTypes: ["FORMS"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 10,
      maximumRunDurationSeconds: 60,
    },
  };
}

function element(id: string, kind: ElementInventoryItem["kind"]): ElementInventoryItem {
  return {
    id,
    kind,
    tagName: kind === "button" ? "button" : "input",
    disabled: false,
    hidden: false,
    locator: { strategy: "css", value: `#${id}` },
  };
}
