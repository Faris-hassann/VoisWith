import { describe, expect, it } from "vitest";
import { buildIssuesFromPages } from "../../src/reporting/issue-builder.js";
import type { PageReport } from "../../src/types/report.js";

describe("buildIssuesFromPages", () => {
  it("groups repeated failed resource observations across pages while preserving failed test count", () => {
    const pages: PageReport[] = [pageFor("/a"), pageFor("/b")];

    const issues = buildIssuesFromPages(pages);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      occurrenceCount: 2,
      failedTestCount: 4,
      relatedTestTypes: ["API_NETWORK", "CONSOLE_ERRORS"],
      affectedPages: ["https://example.com/a", "https://example.com/b"],
    });
  });

  it("keeps unrelated console failures separate", () => {
    const pages: PageReport[] = [
      pageFor("/a"),
      {
        ...pageFor("/b"),
        consoleErrors: [{ type: "error", text: "Uncaught TypeError: boom" }],
        failedNetworkRequests: [],
        tests: [{
          id: "baseline-console",
          name: "Console error check",
          type: "CONSOLE_ERRORS",
          status: "FAILED",
          steps: [],
          assertions: [],
          evidence: [],
          reproductionSteps: [],
        }],
      },
    ];

    const issues = buildIssuesFromPages(pages);

    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.relatedTestTypes?.includes("API_NETWORK"))).toBe(true);
    expect(issues.some((issue) => issue.description.includes("Uncaught TypeError"))).toBe(true);
  });
});

function pageFor(pathname: string): PageReport {
  const url = `https://example.com${pathname}`;
  return {
    url,
    canonicalUrl: url,
    status: "FAILED",
    tests: [
      {
        id: "baseline-network",
        name: "Observed API and network behavior",
        type: "API_NETWORK",
        status: "FAILED",
        steps: [],
        assertions: [],
        evidence: [],
        reproductionSteps: [],
      },
      {
        id: "baseline-console",
        name: "Console error check",
        type: "CONSOLE_ERRORS",
        status: "FAILED",
        steps: [],
        assertions: [],
        evidence: [],
        reproductionSteps: [],
      },
    ],
    consoleErrors: [
      {
        type: "error",
        text: "Failed to load resource: the server responded with a status of 400 () https://example.com/_next/image?url=%2FServices%2FHelpdeskBg.png&w=1920&q=75",
      },
    ],
    failedNetworkRequests: [
      {
        url: "https://example.com/_next/image?url=%2FServices%2FHelpdeskBg.png&w=1920&q=75",
        method: "GET",
        status: 400,
        sameOrigin: true,
        appearsApiRequest: false,
      },
    ],
    performanceObservations: [],
    evidence: [],
  };
}
