import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { mockCompletedReport } from "../lib/testing/mock-reports";
import type { TestingRunRequest } from "../lib/api/types";
import { ReportStoreProvider, useReportStore } from "./report-store-provider";

describe("ReportStoreProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists saved reports to localStorage", async () => {
    const report = mockCompletedReport(request());
    render(
      <ReportStoreProvider>
        <SaveOnMount report={report} />
      </ReportStoreProvider>,
    );

    await waitFor(() => {
      const stored = window.localStorage.getItem("voiswith.testing.reports.v1");
      expect(stored).toContain(report.runId);
    });
  });

  it("hydrates saved reports from localStorage", async () => {
    const report = mockCompletedReport(request());
    window.localStorage.setItem("voiswith.testing.reports.v1", JSON.stringify({ [report.runId]: report }));

    render(
      <ReportStoreProvider>
        <ShowReport runId={report.runId} />
      </ReportStoreProvider>,
    );

    await expect(screen.findByText(report.targetOrigin)).resolves.toBeInTheDocument();
  });
});

function SaveOnMount({ report }: { report: ReturnType<typeof mockCompletedReport> }) {
  const { saveReport } = useReportStore();
  useEffect(() => {
    saveReport(report);
  }, [report, saveReport]);
  return <div>saved</div>;
}

function ShowReport({ runId }: { runId: string }) {
  const { getReport } = useReportStore();
  return <div>{getReport(runId)?.targetOrigin ?? "missing"}</div>;
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
