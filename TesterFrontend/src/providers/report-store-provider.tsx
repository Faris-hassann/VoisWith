"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { TestingRunResponse } from "@/lib/api/types";

interface ReportStore {
  reports: Record<string, TestingRunResponse>;
  saveReport: (report: TestingRunResponse) => void;
  getReport: (runId: string) => TestingRunResponse | undefined;
}

const ReportStoreContext = createContext<ReportStore | undefined>(undefined);

export function ReportStoreProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, TestingRunResponse>>({});
  const value = useMemo<ReportStore>(
    () => ({
      reports,
      saveReport(report) {
        setReports((current) => ({ ...current, [report.runId]: report }));
      },
      getReport(runId) {
        return reports[runId];
      },
    }),
    [reports],
  );
  return <ReportStoreContext.Provider value={value}>{children}</ReportStoreContext.Provider>;
}

export function useReportStore() {
  const context = useContext(ReportStoreContext);
  if (!context) throw new Error("useReportStore must be used within ReportStoreProvider.");
  return context;
}
