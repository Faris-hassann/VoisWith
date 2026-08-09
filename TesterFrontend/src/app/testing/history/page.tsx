"use client";

import Link from "next/link";
import { formatDistanceStrict } from "date-fns";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useReportStore } from "@/providers/report-store-provider";

export default function HistoryPage() {
  const { reports } = useReportStore();
  const savedReports = Object.values(reports).sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );

  if (savedReports.length === 0) {
    return (
      <EmptyState
        title="No saved reports"
        description="Completed reports saved in this browser will appear here."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Report History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reports saved locally in this browser.</p>
      </div>

      <div className="grid gap-3">
        {savedReports.map((report) => {
          const duration = formatDistanceStrict(new Date(report.startedAt), new Date(report.completedAt));
          return (
            <Card key={report.runId}>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="truncate">{report.targetOrigin}</span>
                  </CardTitle>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{report.runId}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/testing/results/${report.runId}`}>View report</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  <Info label="Run" value={<StatusBadge value={report.runStatus} />} />
                  <Info label="Findings" value={<StatusBadge value={report.findingsStatus} />} />
                  <Info label="Completed" value={new Date(report.completedAt).toLocaleString()} />
                  <Info label="Duration" value={duration} />
                  <Info label="Issues" value={`${report.issues.length}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
