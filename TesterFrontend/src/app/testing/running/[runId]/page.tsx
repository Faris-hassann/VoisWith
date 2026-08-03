"use client";

import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Download, Loader2, Pause, Play, Radio, Square, WifiOff } from "lucide-react";
import { use, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { Button } from "@/components/ui/button";
import { buildTestingRunReportUrl, buildTestingRunWebSocketUrl, controlTestingRun, getTestingRunStatus } from "@/lib/api/testing.api";
import type { AsyncRunSnapshot, AsyncRunStatus, RunProgressEvent, TestingRunResponse } from "@/lib/api/types";
import { useReportStore } from "@/providers/report-store-provider";

type ConnectionState = "connecting" | "connected" | "polling" | "closed";

export default function RunningPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const { saveReport } = useReportStore();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [status, setStatus] = useState<AsyncRunStatus>("running");
  const [events, setEvents] = useState<RunProgressEvent[]>([]);
  const [report, setReport] = useState<TestingRunResponse>();
  const [error, setError] = useState<unknown>();
  const [startedAt, setStartedAt] = useState<string>();
  const [liveFrame, setLiveFrame] = useState<string>();
  const [isControlling, setIsControlling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const alertShownRef = useRef(false);
  const terminalRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const applySnapshot = (snapshot: AsyncRunSnapshot) => {
      setStartedAt(snapshot.startedAt);
      setStatus(snapshot.status);
      setEvents(snapshot.events);
      setError(snapshot.error);
      if (snapshot.report) completeWithReport(snapshot.report, snapshot.status);
      if (snapshot.status === "failed") terminalRef.current = true;
    };

    const poll = async () => {
      try {
        const snapshot = await getTestingRunStatus(runId);
        if (!cancelled) applySnapshot(snapshot);
      } catch (caught) {
        if (!cancelled) setError(caught);
      }
    };

    const startPolling = () => {
      if (terminalRef.current || pollTimer) return;
      setConnection("polling");
      void Swal.fire({
        icon: "warning",
        title: "Live connection interrupted",
        text: "The run is still being checked by polling the backend.",
        timer: 2600,
        showConfirmButton: false,
      });
      void poll();
      pollTimer = setInterval(poll, 5000);
    };

    const completeWithReport = (finalReport: TestingRunResponse, finalStatus: AsyncRunStatus = "completed") => {
      terminalRef.current = true;
      setReport(finalReport);
      setStatus(finalStatus);
      saveReport(finalReport);
      if (!alertShownRef.current) {
        alertShownRef.current = true;
        void Swal.fire({
          icon: finalReport.status === "ERROR" ? "error" : "success",
          title: finalReport.status === "ERROR" ? "Run finished with errors" : "Test run completed",
          text: `${finalReport.summary.pagesTested} page(s), ${finalReport.summary.testsExecuted} test(s), ${finalReport.issues.length} issue(s).`,
          confirmButtonText: "View report",
        }).then((result) => {
          if (result.isConfirmed) {
            window.location.assign(`/testing/results/${finalReport.runId}`);
          }
        });
      }
    };

    try {
      ws = new WebSocket(buildTestingRunWebSocketUrl(runId));
      ws.addEventListener("open", () => {
        if (!cancelled) setConnection("connected");
      });
      ws.addEventListener("message", (message) => {
        const payload = JSON.parse(message.data as string) as unknown;
        if (cancelled) return;
        if (isSnapshotMessage(payload)) {
          applySnapshot(payload.snapshot);
          return;
        }
        if (isEventMessage(payload)) {
          setEvents((current) => dedupeEvents([...current, payload.event]));
          if (payload.event.liveFrame) {
            setLiveFrame(`data:${payload.event.liveFrame.mimeType};base64,${payload.event.liveFrame.data}`);
          }
          if (payload.event.report) completeWithReport(payload.event.report, "completed");
          if (payload.event.type === "run.failed") {
            terminalRef.current = true;
            setStatus("failed");
            setError(payload.event.diagnostics ?? payload.event.message);
          }
        }
      });
      ws.addEventListener("close", () => {
        if (!cancelled && !terminalRef.current) startPolling();
        if (!cancelled && terminalRef.current) setConnection("closed");
      });
      ws.addEventListener("error", () => {
        if (!cancelled && !terminalRef.current) startPolling();
      });
    } catch (caught) {
      setError(caught);
      startPolling();
    }

    return () => {
      cancelled = true;
      ws?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [runId, saveReport]);

  const latestEvent = events.at(-1);
  const counts = useMemo(() => summarizeEvents(events, report), [events, report]);
  const discoveredPages = useMemo(() => summarizePages(events, report), [events, report]);
  const generatedTests = useMemo(() => events.filter((event) => event.type === "test_case.started" || event.type === "ai.planning_passed").slice(-30), [events]);

  const controlRun = async (action: "pause" | "resume" | "stop") => {
    setIsControlling(true);
    try {
      const snapshot = await controlTestingRun(runId, action);
      setStatus(snapshot.status);
      setEvents(snapshot.events);
      setError(snapshot.error);
    } catch (caught) {
      setError(caught);
    } finally {
      setIsControlling(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Test Run</h1>
          <p className="mt-1 text-sm text-muted-foreground">Streaming backend progress for run {runId}.</p>
        </div>
        {report ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/testing/results/${report.runId}`}>View report</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={buildTestingRunReportUrl(report.runId)} download>
                <Download className="h-4 w-4" />
                JSON
              </a>
            </Button>
          </div>
        ) : null}
      </div>

      <section className="rounded-lg border bg-card p-5 shadow-sm" aria-live="polite">
        <div className="flex items-center gap-3">
          {status === "completed" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : status === "failed" ? (
            <AlertTriangle className="h-5 w-5 text-red-600" />
          ) : connection === "polling" ? (
            <WifiOff className="h-5 w-5 text-amber-600" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
          <div>
            <h2 className="font-semibold">{latestEvent?.message ?? "Connecting to backend stream"}</h2>
            <p className="text-sm text-muted-foreground">
              {connectionLabel(connection)} · {status} · elapsed {elapsed}s
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Pages tested" value={`${counts.pagesTested}`} />
          <Info label="Tests executed" value={`${counts.testsExecuted}`} />
          <Info label="AI planned" value={`${counts.aiPlanned}`} />
          <Info label="Issues" value={`${counts.issues}`} />
          <Info label="Started" value={startedAt ? new Date(startedAt).toLocaleTimeString() : "Starting"} />
          <Info label="Connection" value={connectionLabel(connection)} />
          <Info label="Current page" value={latestEvent?.pageUrl ?? "Waiting"} />
          <Info label="Latest event" value={latestEvent?.type ?? "run.pending"} />
        </div>

        {error ? (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md border bg-background p-3 text-xs text-red-600">
            {stringify(error)}
          </pre>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={isControlling || status !== "running"} onClick={() => controlRun("pause")}>
            <Pause className="h-4 w-4" />
            Pause
          </Button>
          <Button type="button" variant="outline" disabled={isControlling || status !== "paused"} onClick={() => controlRun("resume")}>
            <Play className="h-4 w-4" />
            Resume
          </Button>
          <Button type="button" variant="outline" disabled={isControlling || ["completed", "failed", "stopped"].includes(status)} onClick={() => controlRun("stop")}>
            <Square className="h-4 w-4" />
            Stop
          </Button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Live browser</h2>
          <div className="mt-3 aspect-video overflow-hidden rounded-md border bg-background">
            {liveFrame ? (
              <img src={liveFrame} alt="Live browser frame" className="h-full w-full object-contain" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">Waiting for live-view frames.</div>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">DFS discovery</h2>
          <div className="mt-3 max-h-80 overflow-auto rounded-md border bg-background">
            {discoveredPages.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No pages reported yet.</div>
            ) : (
              discoveredPages.map((page) => (
                <div key={page.url} className="border-b p-3 text-sm last:border-b-0">
                  <div className="truncate font-medium" title={page.url}>{page.url}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{page.status}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel title="Generated tests" empty="No generated tests yet." events={generatedTests} />
        <Panel title="Console and network" empty="No console or network issue events yet." events={events.filter((event) => event.type.includes("network") || event.type.includes("console") || event.type === "page.snapshot_collected").slice(-30)} />
      </section>

      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Live events</h2>
        </div>
        <div className="max-h-[520px] overflow-auto rounded-md border bg-background">
          {events.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Waiting for the backend to send the first event.</div>
          ) : (
            events.slice(-120).reverse().map((event) => (
              <div key={event.sequence} className="border-b p-3 text-sm last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{event.type}</span>
                  <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{event.status}</span>
                  <span className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{event.message}</p>
                {event.pageUrl ? <p className="mt-1 truncate text-xs text-muted-foreground">{event.pageUrl}</p> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Panel({ title, empty, events }: { title: string; empty: string; events: RunProgressEvent[] }) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 max-h-80 overflow-auto rounded-md border bg-background">
        {events.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">{empty}</div>
        ) : (
          events.slice().reverse().map((event) => (
            <div key={`${event.sequence}-${event.type}`} className="border-b p-3 text-sm last:border-b-0">
              <div className="flex flex-wrap gap-2">
                <span className="font-medium">{event.type}</span>
                <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{event.status}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{event.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium" title={value}>{value}</div>
    </div>
  );
}

function dedupeEvents(events: RunProgressEvent[]): RunProgressEvent[] {
  const bySequence = new Map(events.map((event) => [event.sequence, event]));
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

function summarizeEvents(events: RunProgressEvent[], report?: TestingRunResponse) {
  if (report) {
    return {
      pagesTested: report.summary.pagesTested,
      testsExecuted: report.summary.testsExecuted,
      aiPlanned: report.diagnostics?.ai.successes ?? 0,
      issues: report.issues.length,
    };
  }
  return {
    pagesTested: events.filter((event) => event.type === "page.report_written").length,
    testsExecuted: events.filter((event) => event.type === "test_case.passed" || event.type === "test_case.failed").length,
    aiPlanned: events.filter((event) => event.type === "ai.planning_passed").length,
    issues: events.filter((event) => event.type === "test_case.failed" || event.type === "ai.planning_failed").length,
  };
}

function summarizePages(events: RunProgressEvent[], report?: TestingRunResponse): Array<{ url: string; status: string }> {
  if (report) {
    return report.pages.map((page) => ({ url: page.url, status: `${page.status}${page.stateFingerprint ? ` · ${page.stateFingerprint}` : ""}` }));
  }
  const byUrl = new Map<string, string>();
  for (const event of events) {
    if (!event.pageUrl) continue;
    if (event.type.includes("page") || event.type.includes("crawl")) byUrl.set(event.pageUrl, event.type);
  }
  return [...byUrl.entries()].map(([url, status]) => ({ url, status }));
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "connected") return "Live WebSocket connected";
  if (connection === "polling") return "Polling backend fallback";
  if (connection === "closed") return "Stream closed";
  return "Connecting";
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unknown run error";
  }
}

function isSnapshotMessage(payload: unknown): payload is { type: "run.snapshot"; snapshot: AsyncRunSnapshot } {
  return Boolean(payload && typeof payload === "object" && "type" in payload && payload.type === "run.snapshot" && "snapshot" in payload);
}

function isEventMessage(payload: unknown): payload is { type: "run.event"; event: RunProgressEvent } {
  return Boolean(payload && typeof payload === "object" && "type" in payload && payload.type === "run.event" && "event" in payload);
}
