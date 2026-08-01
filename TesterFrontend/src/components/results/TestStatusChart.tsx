"use client";

import type { TestingRunResponse } from "@/lib/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const colors: Record<string, string> = {
  PASSED: "bg-emerald-500",
  FAILED: "bg-red-500",
  SKIPPED: "bg-amber-500",
  BLOCKED_BY_POLICY: "bg-violet-500",
  INCONCLUSIVE: "bg-slate-500",
  ERROR: "bg-red-700",
};

export function TestStatusChart({ report }: { report: TestingRunResponse }) {
  const statusData = [
    { name: "PASSED", value: report.summary.passedTests },
    { name: "FAILED", value: report.summary.failedTests },
    { name: "SKIPPED", value: report.summary.skippedTests },
    { name: "BLOCKED_BY_POLICY", value: report.summary.blockedByPolicy },
    { name: "INCONCLUSIVE", value: report.summary.inconclusiveTests },
  ].filter((item) => item.value > 0);

  const byType = Object.entries(
    report.pages.flatMap((page) => page.tests).reduce<Record<string, number>>((acc, test) => {
      acc[test.type] = (acc[test.type] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Status distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <BarList data={statusData} total={Math.max(1, report.summary.testsExecuted)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tests by type</CardTitle>
        </CardHeader>
        <CardContent>
          <BarList data={byType} total={Math.max(1, ...byType.map((item) => item.value))} compact />
        </CardContent>
      </Card>
    </div>
  );
}

function BarList({
  data,
  total,
  compact,
}: {
  data: Array<{ name: string; value: number }>;
  total: number;
  compact?: boolean;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No chartable test data returned.</p>;
  }

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const width = `${Math.max(4, Math.round((item.value / total) * 100))}%`;
        return (
          <div key={item.name} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={compact ? "truncate font-mono" : "font-medium"}>
                {item.name.replaceAll("_", " ")}
              </span>
              <span className="font-semibold">{item.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full ${colors[item.name] ?? "bg-primary"}`} style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
