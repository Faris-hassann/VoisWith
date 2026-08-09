import crypto from "node:crypto";
import type { RunOrchestrator } from "../services/run-orchestrator.js";
import type { TestingRunRequest } from "../types/testing.js";
import type { TestingRunResponse } from "../types/report.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { serializeError } from "../errors/serialize-error.js";
import type { AsyncRunSnapshot, AsyncRunStatus, RunProgressEvent, RunProgressEventInput } from "./run-events.js";

type RunListener = (event: RunProgressEvent) => void;

interface RunRecord {
  runId: string;
  status: AsyncRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  sequence: number;
  events: RunProgressEvent[];
  listeners: Set<RunListener>;
  report?: TestingRunResponse;
  error?: unknown;
  paused: boolean;
  stopped: boolean;
  pauseWaiters: Set<() => void>;
}

const MAX_BUFFERED_EVENTS = 500;
const CLEANUP_AFTER_MS = 60 * 60 * 1000;

export class RunRegistry {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly orchestrator: RunOrchestrator) {}

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

  subscribe(runId: string, listener: RunListener): () => void {
    const record = this.runs.get(runId);
    if (!record) return () => undefined;
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
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
    record.events.push(event);
    if (record.events.length > MAX_BUFFERED_EVENTS) {
      record.events.splice(0, record.events.length - MAX_BUFFERED_EVENTS);
    }
    for (const listener of record.listeners) listener(event);
    return event;
  }

  private complete(runId: string, report: TestingRunResponse): void {
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
      events: [...record.events],
      report: record.report,
      error: record.error,
    };
  }

  private scheduleCleanup(runId: string): void {
    setTimeout(() => {
      const record = this.runs.get(runId);
      if (record?.status === "completed" || record?.status === "failed") {
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
