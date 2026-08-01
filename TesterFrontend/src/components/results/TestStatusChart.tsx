"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TestingRunResponse } from "@/lib/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const colors: Record<string, string> = {
  PASSED: "#10b981",
  FAILED: "#ef4444",
  SKIPPED: "#f59e0b",
  BLOCKED_BY_POLICY: "#8b5cf6",
  INCONCLUSIVE: "#64748b",
  ERROR: "#dc2626",
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
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Status distribution</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} label>
                {statusData.map((entry) => <Cell key={entry.name} fill={colors[entry.name]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tests by type</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byType}>
              <XAxis dataKey="name" hide />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
