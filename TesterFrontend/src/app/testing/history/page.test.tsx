import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockCompletedReport } from "../../../lib/testing/mock-reports";
import type { TestingRunRequest } from "../../../lib/api/types";
import HistoryPage from "./page";

describe("HistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders disk-backed run summaries with result links", async () => {
    const report = mockCompletedReport(request());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [{
      runId: report.runId,
      targetOrigin: report.targetOrigin,
      runStatus: report.runStatus,
      findingsStatus: report.findingsStatus,
      status: report.status,
      stoppedReason: report.stoppedReason,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      summary: report.summary,
      issueCount: report.issues.length,
      artifactsBytes: report.summary.artifactsBytes,
    }] }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<HistoryPage />);

    expect(await screen.findByText(report.targetOrigin)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", `/testing/results/${report.runId}`);
  });
});

function request(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    testTypes: ["SMOKE"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 1,
      maximumRunDurationSeconds: 30,
    },
  };
}
