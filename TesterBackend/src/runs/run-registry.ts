import crypto from "node:crypto";
import type { RunOrchestrator } from "../services/run-orchestrator.js";
import type { TestingRunRequest } from "../types/testing.js";
import type { TestingRunResponse } from "../types/report.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { serializeError } from "../errors/serialize-error.js";
import type { AsyncRunSnapshot, AsyncRunStatus, RunProgressEvent, RunProgressEventInput } from "./run-events.js";
import type { RunHistoryStore } from "./run-history-store.js";

type RunListener = (event: RunProgressEvent) => void;

interface RunRecord {
  runId: string;
  status: AsyncRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  sequence: number;
  events: RunProgressEvent[];
  latestFrame?: RunProgressEvent;
  latestCursor?: RunProgressEvent;
  listeners: Set<RunListener>;
  report?: TestingRunResponse;
  error?: unknown;
  paused: boolean;
  stopped: boolean;
  pauseWaiters: Set<() => void>;
}

const MAX_BUFFERED_EVENTS = 2_000;
const CLEANUP_AFTER_MS = 10 * 60 * 1000;

export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly orchestrator: RunOrchestrator, private readonly history?: RunHistoryStore) {}

  start(request: TestingRunRequest): AsyncRunSnapshot {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: RunRecord = {
      runId,
      status: "running",
      startedAt: now,
      updatedAt: now,
      sequence: 0,
      events: [],
      listeners: new Set(),
      paused: false,
      stopped: false,
      pauseWaiters: new Set(),
    };
    this.runs.set(runId, record);
    this.append(runId, {
      runId,
      type: "run.started",
      status: "started",
      message: "Test run accepted and started in the backend.",
    });

    void this.orchestrator
      .run(request, {
        runId,
        onEvent: (event) => this.append(runId, event),
        control: {
          isStopped: () => this.runs.get(runId)?.stopped ?? true,
          waitWhilePaused: () => this.waitWhilePaused(runId),
        },
      })
      .then((report) => this.complete(runId, report))
      .catch((error) => this.fail(runId, error));

    return this.snapshot(record);
  }

  get(runId: string): AsyncRunSnapshot | undefined {
    const record = this.runs.get(runId);
    return record ? this.snapshot(record) : undefined;
  }

  snapshotEvents(runId: string, lastSequence?: number): RunProgressEvent[] | undefined {
    const record = this.runs.get(runId);
    return record ? this.listSnapshotEvents(record, lastSequence) : undefined;
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const record = this.runs.get(runId);
    if (!record) return () => undefined;
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  eventsAfter(runId: string, lastSequence: number): RunProgressEvent[] | undefined {
    const record = this.runs.get(runId);
    return record ? record.events.filter((event) => event.sequence > lastSequence) : undefined;
  }

  isTerminal(runId: string): boolean {
    const status = this.runs.get(runId)?.status;
    return status === "completed" || status === "failed" || status === "stopped";
  }

  pause(runId: string): AsyncRunSnapshot | undefined {
    const record = this.runs.get(runId);
    if (!record || record.status !== "running") return record ? this.snapshot(record) : undefined;
    record.paused = true;
    record.status = "paused";
    this.append(runId, {
      runId,
      type: "run:paused",
      status: "started",
      message: "Test run paused.",
    });
    return this.snapshot(record);
  }

  resume(runId: string): AsyncRunSnapshot | undefined {
    const record = this.runs.get(runId);
    if (!record || record.status !== "paused") return record ? this.snapshot(record) : undefined;
    record.paused = false;
    record.status = "running";
    for (const resolve of record.pauseWaiters) resolve();
    record.pauseWaiters.clear();
    this.append(runId, {
      runId,
      type: "run:resumed",
      status: "started",
      message: "Test run resumed.",
    });
    return this.snapshot(record);
  }

  stop(runId: string): AsyncRunSnapshot | undefined {
    const record = this.runs.get(runId);
    if (!record) return undefined;
    if (record.status === "completed" || record.status === "failed" || record.status === "stopped") return this.snapshot(record);
    record.stopped = true;
    record.paused = false;
    record.status = "stopping";
    for (const resolve of record.pauseWaiters) resolve();
    record.pauseWaiters.clear();
    this.append(runId, {
      runId,
      type: "run:stopped",
      status: "blocked",
      message: "Stop requested for test run.",
    });
    return this.snapshot(record);
  }

  append(runId: string, input: RunProgressEventInput): RunProgressEvent | undefined {
    const record = this.runs.get(runId);
    if (!record) return undefined;
    const event: RunProgressEvent = {
      ...redactSecrets(input),
      runId,
      sequence: ++record.sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
    } as RunProgressEvent;
    record.updatedAt = event.timestamp;
    this.history?.noteSequence(runId, event.sequence);
    if (event.liveFrame) {
      record.latestFrame = event;
    } else if (event.liveCursor) {
      record.latestCursor = event;
    } else {
      record.events.push(event);
    }
    if (record.events.length > MAX_BUFFERED_EVENTS) {
      record.events.splice(0, record.events.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of record.listeners) listener(event);
    return event;
  }

  private async complete(runId: string, report: TestingRunResponse): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) return;
    record.status = record.stopped ? "stopped" : "completed";
    record.report = report;
    record.completedAt = new Date().toISOString();
    record.updatedAt = record.completedAt;
    this.append(runId, {
      runId,
      type: "run.completed",
      status: record.stopped ? "skipped" : "passed",
      message: record.stopped ? "Test run stopped." : `Test run completed with runStatus ${report.runStatus} and findingsStatus ${report.findingsStatus}.`,
      counts: {
        pagesTested: report.summary.pagesTested,
        testsExecuted: report.summary.testsExecuted,
        issues: report.issues.length,
      },
      stoppedReason: report.stoppedReason,
      report,
    });
    this.append(runId, {
      runId,
      type: "run.report_ready",
      status: report.runStatus === "ERRORED" ? "failed" : "passed",
      message: `Final report is ready with runStatus ${report.runStatus} and findingsStatus ${report.findingsStatus}.`,
      counts: {
        pagesTested: report.summary.pagesTested,
        testsExecuted: report.summary.testsExecuted,
        issues: report.issues.length,
      },
      stoppedReason: report.stoppedReason,
    });
    await this.history?.persistSequence(runId).catch(() => undefined);
    this.scheduleCleanup(runId);
  }

  private fail(runId: string, error: unknown): void {
    const record = this.runs.get(runId);
    if (!record) return;
    const serialized = serializeError(error);
    record.status = "failed";
    record.error = serialized;
    record.completedAt = new Date().toISOString();
    record.updatedAt = record.completedAt;
    this.append(runId, {
      runId,
      type: "run.failed",
      status: "failed",
      message: serialized.message,
      diagnostics: serialized,
    });
    this.scheduleCleanup(runId);
  }

  private snapshot(record: RunRecord): AsyncRunSnapshot {
    return {
      runId: record.runId,
      status: record.status,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      events: this.listSnapshotEvents(record),
      report: record.report,
      error: record.error,
    };
  }

  private listSnapshotEvents(record: RunRecord, lastSequence?: number): RunProgressEvent[] {
    const events = lastSequence === undefined
      ? [...record.events]
      : record.events.filter((event) => event.sequence > lastSequence);
    const includedSequences = new Set(events.map((event) => event.sequence));

    for (const liveEvent of [record.latestFrame, record.latestCursor]) {
      if (!liveEvent) continue;
      if (!includedSequences.has(liveEvent.sequence)) {
        events.push(liveEvent);
        includedSequences.add(liveEvent.sequence);
      }
    }

    return events.sort((a, b) => a.sequence - b.sequence);
  }

  private scheduleCleanup(runId: string): void {
    setTimeout(() => {
      const record = this.runs.get(runId);
      if (record?.status === "completed" || record?.status === "failed" || record?.status === "stopped") {
        this.runs.delete(runId);
      }
    }, CLEANUP_AFTER_MS).unref();
  }

  private async waitWhilePaused(runId: string): Promise<void> {
    for (;;) {
      const record = this.runs.get(runId);
      if (!record || record.stopped || !record.paused) return;
      await new Promise<void>((resolve) => record.pauseWaiters.add(resolve));
    }
  }
}
