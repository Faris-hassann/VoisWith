"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TestingRunResponse } from "@/lib/api/types";

interface ReportStore {
  reports: Record<string, TestingRunResponse>;
  saveReport: (report: TestingRunResponse) => void;
  getReport: (runId: string) => TestingRunResponse | undefined;
}

const ReportStoreContext = createContext<ReportStore | undefined>(undefined);
const STORAGE_KEY = "voiswith.testing.reports.v1";

export function ReportStoreProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, TestingRunResponse>>({});

  useEffect(() => {
    const storedReports = readStoredReports();
    setReports((current) => ({ ...storedReports, ...current }));
  }, []);

  const saveReport = useCallback((report: TestingRunResponse) => {
    setReports((current) => {
      const next = { ...current, [report.runId]: report };
      writeStoredReports(next);
      return next;
    });
  }, []);

  const getReport = useCallback((runId: string) => reports[runId], [reports]);

  const value = useMemo<ReportStore>(
    () => ({
      reports,
      saveReport,
      getReport,
    }),
    [getReport, reports, saveReport],
  );
  return <ReportStoreContext.Provider value={value}>{children}</ReportStoreContext.Provider>;
}

export function useReportStore() {
  const context = useContext(ReportStoreContext);
  if (!context) throw new Error("useReportStore must be used within ReportStoreProvider.");
  return context;
}

function readStoredReports(): Record<string, TestingRunResponse> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, TestingRunResponse>;
  } catch {
    return {};
  }
}

function writeStoredReports(reports: Record<string, TestingRunResponse>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch {
    // Ignore quota/private-mode storage errors; in-memory reports still work.
  }
}
