"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ResultsDashboard } from "@/components/results/ResultsDashboard";
import { useReportStore } from "@/providers/report-store-provider";
import { getTestingRunStatus, listTestingRuns } from "@/lib/api/testing.api";
import type { TestingRunResponse } from "@/lib/api/types";

export default function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { getReport, saveReport } = useReportStore();
  const cached = runId === "latest" ? undefined : getReport(runId);
  const [report, setReport] = useState<TestingRunResponse | undefined>(cached);
  const [loading, setLoading] = useState(!cached);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (report) return;
    let cancelled = false;
    void (async () => {
      const resolvedRunId = runId === "latest" ? (await listTestingRuns()).runs[0]?.runId : runId;
      if (!resolvedRunId) return;
      const snapshot = await getTestingRunStatus(resolvedRunId);
      if (snapshot.report && !cancelled) {
        saveReport(snapshot.report);
        setReport(snapshot.report);
      }
    })().catch(() => { if (!cancelled) setLoadFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [report, runId, saveReport]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading retained report…</div>;
  if (!report) {
    return (
      <EmptyState
        title="Report not available"
        description={loadFailed ? "The backend could not load this retained report." : "No retained backend report was found for this run."}
        action={<Button asChild><Link href="/testing/new">New Test</Link></Button>}
      />
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sanitized backend report for run {report.runId}.</p>
      </div>
      <ResultsDashboard report={report} />
    </div>
  );
}
