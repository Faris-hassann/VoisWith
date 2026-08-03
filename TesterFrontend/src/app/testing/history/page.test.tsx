import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { mockCompletedReport } from "../../../lib/testing/mock-reports";
import type { TestingRunRequest, TestingRunResponse } from "../../../lib/api/types";
import { ReportStoreProvider, useReportStore } from "../../../providers/report-store-provider";
import HistoryPage from "./page";

describe("HistoryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders saved reports with result links", async () => {
    const report = mockCompletedReport(request());
    render(
      <ReportStoreProvider>
        <SaveReport report={report} />
        <HistoryPage />
      </ReportStoreProvider>,
    );

    expect(await screen.findByText(report.targetOrigin)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", `/testing/results/${report.runId}`);
  });
});

function SaveReport({ report }: { report: TestingRunResponse }) {
  const { saveReport } = useReportStore();
  useEffect(() => {
    saveReport(report);
  }, [report, saveReport]);
  return null;
}

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
