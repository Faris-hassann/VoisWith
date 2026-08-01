"use client";

import * as Tabs from "@radix-ui/react-tabs";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceStrict } from "date-fns";
import { useMemo } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ConsoleObservation, Issue, NetworkObservation, PageReport, PerformanceObservation, TestCaseResult, TestingRunResponse } from "@/lib/api/types";
import { RawReportViewer } from "./RawReportViewer";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { SimpleTable } from "./SimpleTable";
import { TestStatusChart } from "./TestStatusChart";
import { TestSummaryCards } from "./TestSummaryCards";

const tabs = ["Overview", "Diagnostics", "Pages", "Test Cases", "Issues", "Network", "Console", "Performance", "Security", "Artifacts", "Coverage", "Raw Report"];

export function ResultsDashboard({ report }: { report: TestingRunResponse }) {
  const tests = report.pages.flatMap((page) => page.tests.map((test) => ({ ...test, pageUrl: page.url })));
  const network = report.pages.flatMap((page) => page.failedNetworkRequests.map((item) => ({ ...item, pageUrl: page.url })));
  const consoleItems = report.pages.flatMap((page) => page.consoleErrors.map((item) => ({ ...item, pageUrl: page.url })));
  const performance = report.pages.flatMap((page) => page.performanceObservations.map((item) => ({ ...item, pageUrl: page.url })));
  const duration = formatDistanceStrict(new Date(report.startedAt), new Date(report.completedAt));

  const pageColumns = useMemo<ColumnDef<PageReport>[]>(() => [
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { header: "URL", accessorKey: "url", cell: ({ row }) => <span className="font-mono text-xs">{row.original.url}</span> },
    { header: "Tests", cell: ({ row }) => row.original.tests.length },
    { header: "Console", cell: ({ row }) => row.original.consoleErrors.length },
    { header: "Network", cell: ({ row }) => row.original.failedNetworkRequests.length },
  ], []);
  const testColumns = useMemo<ColumnDef<TestCaseResult & { pageUrl: string }>[]>(() => [
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { header: "ID", accessorKey: "id" },
    { header: "Name", accessorKey: "name" },
    { header: "Type", accessorKey: "type" },
    { header: "Page", accessorKey: "pageUrl", cell: ({ row }) => <span className="font-mono text-xs">{row.original.pageUrl}</span> },
    { header: "Priority", accessorKey: "priority" },
    { header: "Severity", cell: ({ row }) => row.original.severity ? <StatusBadge value={row.original.severity} /> : "—" },
    { header: "Confidence", cell: ({ row }) => row.original.confidence ?? "—" },
  ], []);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <Info label="Run ID" value={report.runId} mono />
          <Info label="Target origin" value={report.targetOrigin} mono />
          <Info label="Status" value={<StatusBadge value={report.status} />} />
          <Info label="Duration" value={duration} />
          <Info label="Safe mode" value="Backend policy enforced" />
        </CardContent>
      </Card>
      <TestSummaryCards summary={report.summary} />
      <Tabs.Root defaultValue="Overview" className="space-y-4">
        <Tabs.List className="flex gap-2 overflow-x-auto rounded-lg border bg-card p-2">
          {tabs.map((tab) => <Tabs.Trigger key={tab} value={tab} className="rounded-md px-3 py-2 text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">{tab}</Tabs.Trigger>)}
        </Tabs.List>
        <Tabs.Content value="Overview" className="space-y-4">
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            HTTP 200 means the backend completed the run request. The run status and test statuses below describe what happened while testing the target website.
          </div>
          <TestStatusChart report={report} />
        </Tabs.Content>
        <Tabs.Content value="Diagnostics"><DiagnosticsPanel report={report} /></Tabs.Content>
        <Tabs.Content value="Pages"><SimpleTable data={report.pages} columns={pageColumns} searchPlaceholder="Search pages" /></Tabs.Content>
        <Tabs.Content value="Test Cases"><SimpleTable data={tests} columns={testColumns} searchPlaceholder="Filter by status, type, page, or text" /></Tabs.Content>
        <Tabs.Content value="Issues">{report.issues.length ? <SimpleTable data={report.issues} columns={issueColumns} /> : <EmptyState title="No issues" description="The backend did not report discovered issues." />}</Tabs.Content>
        <Tabs.Content value="Network">{network.length ? <SimpleTable data={network} columns={networkColumns} /> : <EmptyState title="No failed network requests" description="No failed or error-status network observations were returned." />}</Tabs.Content>
        <Tabs.Content value="Console">{consoleItems.length ? <SimpleTable data={consoleItems} columns={consoleColumns} /> : <EmptyState title="No console errors" description="No console errors were returned." />}</Tabs.Content>
        <Tabs.Content value="Performance">{performance.length ? <SimpleTable data={performance} columns={performanceColumns} /> : <EmptyState title="No performance observations" description="The backend did not return performance observations." />}</Tabs.Content>
        <Tabs.Content value="Security"><Notice text="No exploitative penetration testing was performed. Passive security observations appear as issues, console warnings, network observations, or coverage limitations when returned by the backend." /></Tabs.Content>
        <Tabs.Content value="Artifacts">{report.artifacts.length ? <SimpleTable data={report.artifacts} columns={artifactColumns} /> : <EmptyState title="No artifacts" description="The backend did not return artifact references." />}</Tabs.Content>
        <Tabs.Content value="Coverage">{report.coverageLimitations.length ? <SimpleTable data={report.coverageLimitations} columns={coverageColumns} /> : <EmptyState title="No coverage limitations" description="No coverage limitations were returned." />}</Tabs.Content>
        <Tabs.Content value="Raw Report"><RawReportViewer report={report} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className={mono ? "mt-1 truncate font-mono text-xs" : "mt-1 font-medium"}>{value}</div></div>;
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">{text}</div>;
}

const issueColumns: ColumnDef<Issue>[] = [
  { header: "Severity", cell: ({ row }) => <StatusBadge value={row.original.severity} /> },
  { header: "Title", accessorKey: "title" },
  { header: "Page", accessorKey: "pageUrl" },
  { header: "Confidence", accessorKey: "confidence" },
];
const networkColumns: ColumnDef<NetworkObservation & { pageUrl: string }>[] = [
  { header: "Method", accessorKey: "method" },
  { header: "Status", accessorKey: "status" },
  { header: "URL", accessorKey: "url" },
  { header: "Duration", cell: ({ row }) => row.original.durationMs ? `${row.original.durationMs}ms` : "—" },
  { header: "Failure", accessorKey: "failureReason" },
];
const consoleColumns: ColumnDef<ConsoleObservation & { pageUrl: string }>[] = [
  { header: "Level", accessorKey: "type" },
  { header: "Message", accessorKey: "text" },
  { header: "Page", accessorKey: "pageUrl" },
];
const performanceColumns: ColumnDef<PerformanceObservation & { pageUrl: string }>[] = [
  { header: "Name", accessorKey: "name" },
  { header: "Value", cell: ({ row }) => row.original.valueMs ? `${row.original.valueMs}ms` : "—" },
  { header: "Description", accessorKey: "description" },
];
const artifactColumns: ColumnDef<{ id: string; type: string; path: string; description?: string }>[] = [
  { header: "Type", accessorKey: "type" },
  { header: "Path", accessorKey: "path" },
  { header: "Description", accessorKey: "description" },
];
const coverageColumns: ColumnDef<{ area: string; reason: string; recommendation?: string }>[] = [
  { header: "Area", accessorKey: "area" },
  { header: "Reason", accessorKey: "reason" },
  { header: "Recommendation", accessorKey: "recommendation" },
];
