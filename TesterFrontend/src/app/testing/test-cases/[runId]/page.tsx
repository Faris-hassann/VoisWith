"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/ui/status-badge";
import { getTestingRunStatus, listTestingRuns } from "@/lib/api/testing.api";
import type { FormTestCaseState, TestingRunResponse } from "@/lib/api/types";
import { useReportStore } from "@/providers/report-store-provider";

export default function TestCasesPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { getReport, saveReport } = useReportStore();
  const cached = runId === "latest" ? undefined : getReport(runId);
  const [report, setReport] = useState<TestingRunResponse | undefined>(cached);
  const [cases, setCases] = useState<FormTestCaseState[]>(() => casesFromReport(cached));
  const [runStatus, setRunStatus] = useState<string>("running");
  const [loading, setLoading] = useState(!cached);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeClock, setActiveClock] = useState(0);
  const holdStarts = useRef(new Map<string, number>());

  useEffect(() => {
    const timer = setInterval(() => setActiveClock((value) => runStatus === "paused" ? value : value + 1), 1000);
    return () => clearInterval(timer);
  }, [runStatus]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      const resolvedRunId = runId === "latest" ? (await listTestingRuns()).runs[0]?.runId : runId;
      if (!resolvedRunId) return;
      const snapshot = await getTestingRunStatus(resolvedRunId);
      if (cancelled) return;
      setRunStatus(snapshot.status);
      if (snapshot.formTestCases) setCases(snapshot.formTestCases);
      if (snapshot.report) {
        saveReport(snapshot.report);
        setReport(snapshot.report);
        if (!snapshot.formTestCases) setCases(casesFromReport(snapshot.report));
      }
      if (["completed", "failed", "stopped"].includes(snapshot.status) && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };
    void load().catch(() => { if (!cancelled) setLoadFailed(true); }).finally(() => { if (!cancelled) setLoading(false); });
    pollTimer = setInterval(() => void load().catch(() => undefined), 2500);
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId, saveReport]);

  const groups = useMemo(() => groupCases(cases), [cases]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading generated test cases...</div>;
  if (cases.length === 0) {
    return (
      <EmptyState
        title="No generated form cases"
        description={loadFailed ? "The backend could not load case state for this run." : "No AI or deterministic form cases have been planned for this run yet."}
        action={<Button asChild><Link href={report ? `/testing/results/${report.runId}` : "/testing/new"}>{report ? "View Report" : "New Test"}</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Implemented Test Cases</h1>
          <p className="mt-1 text-sm text-muted-foreground">Generated form cases for run {report?.runId ?? runId}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href={`/testing/running/${report?.runId ?? runId}`}>Live run</Link></Button>
          {report ? <Button asChild><Link href={`/testing/results/${report.runId}`}>Report</Link></Button> : null}
        </div>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Info label="Cases" value={`${cases.length}`} />
        <Info label="Planned" value={`${cases.filter((item) => item.status === "planned").length}`} />
        <Info label="Holding" value={`${cases.filter((item) => item.status === "holding").length}`} />
        <Info label="Submitting" value={`${cases.filter((item) => item.status === "submitting").length}`} />
        <Info label="Finished" value={`${cases.filter((item) => ["passed", "failed", "inconclusive"].includes(item.status)).length}`} />
      </div>

      {groups.map((group) => (
        <section key={`${group.pageUrl}-${group.formId}`} className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">{group.formId}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">{group.pageUrl}</p>
          </div>
          <div className="mt-4 space-y-3">
            {group.items.map((item) => (
              <div key={`${item.caseId}-${item.role ?? ""}-${item.viewport ?? ""}`} className="rounded-md border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={item.resultStatus ?? item.status} />
                  <span className="font-medium">{item.testCase.intent}</span>
                  <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{item.planningSource}</span>
                  {item.role ? <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{item.role}</span> : null}
                  {item.viewport ? <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{item.viewport}</span> : null}
                </div>
                <div className="mt-3 grid gap-3 text-sm lg:grid-cols-3">
                  <Info label="Expected" value={item.testCase.expectedOutcome.kind} />
                  <Info label="Submit" value={item.submit ? "Yes" : "No"} />
                  <Info label="Selected button" value={item.selectedButton ?? "Not selected yet"} />
                  {item.status === "holding" ? <Info label="Countdown" value={`${remainingHoldSeconds(item, activeClock, holdStarts.current)}s`} /> : null}
                  {item.resultMessage ? <Info label="Result" value={item.resultMessage} /> : null}
                </div>
                <div className="mt-3 overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr><th className="px-3 py-2">Element</th><th className="px-3 py-2">Generated value</th></tr>
                    </thead>
                    <tbody>
                      {item.testCase.inputs.map((input) => (
                        <tr key={input.elementId} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{input.elementId}</td>
                          <td className="px-3 py-2">{input.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function casesFromReport(report?: TestingRunResponse): FormTestCaseState[] {
  if (!report) return [];
  return report.pages.flatMap((page) =>
    (page.plannedTestCases ?? []).map((testCase) => {
      const result = page.tests.find((item) => item.id === testCase.caseId);
      return {
        runId: report.runId,
        caseId: testCase.caseId,
        formId: testCase.formId,
        pageUrl: page.url,
        role: page.role,
        viewport: page.viewport,
        locale: page.locale,
        planningSource: page.planningSource ?? "mixed",
        testCase,
        status: result?.status === "PASSED" ? "passed" : result?.status === "FAILED" || result?.status === "ERROR" ? "failed" : result ? "inconclusive" : "planned",
        submit: testCase.submit,
        resultStatus: result?.status,
        resultMessage: result?.actualResult,
      };
    }),
  );
}

function groupCases(cases: FormTestCaseState[]) {
  const byGroup = new Map<string, { pageUrl: string; formId: string; items: FormTestCaseState[] }>();
  for (const item of cases) {
    const key = `${item.pageUrl}:${item.formId}`;
    const group = byGroup.get(key) ?? { pageUrl: item.pageUrl, formId: item.formId, items: [] };
    group.items.push(item);
    byGroup.set(key, group);
  }
  return [...byGroup.values()];
}

function remainingHoldSeconds(item: FormTestCaseState, activeClock: number, holdStarts: Map<string, number>): number {
  if (!item.holdDurationSeconds) return item.holdRemainingSeconds ?? 0;
  const key = `${item.pageUrl}:${item.formId}:${item.caseId}:${item.role ?? ""}:${item.viewport ?? ""}:${item.locale ?? ""}`;
  if (!holdStarts.has(key)) {
    const serverElapsed = item.holdStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(item.holdStartedAt).getTime()) / 1000)) : 0;
    holdStarts.set(key, activeClock - Math.min(serverElapsed, item.holdDurationSeconds));
  }
  const startedAtClock = holdStarts.get(key) ?? activeClock;
  return Math.max(0, item.holdDurationSeconds - (activeClock - startedAtClock));
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}
