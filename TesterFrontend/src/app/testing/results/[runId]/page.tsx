"use client";

import Link from "next/link";
import { use } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ResultsDashboard } from "@/components/results/ResultsDashboard";
import { useReportStore } from "@/providers/report-store-provider";

export default function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { getReport, reports } = useReportStore();
  const report = runId === "latest" ? Object.values(reports).at(-1) : getReport(runId);
  if (!report) {
    return (
      <EmptyState
        title="Report not available"
        description="Reports are held in memory for this prototype. Run a new test or enable mock mode to view sample results."
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
