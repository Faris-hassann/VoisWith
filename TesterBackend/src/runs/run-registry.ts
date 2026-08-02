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
    record.status = "completed";
    record.report = report;
    record.completedAt = new Date().toISOString();
    record.updatedAt = record.completedAt;
    this.append(runId, {
      runId,
      type: "run.completed",
      status: "passed",
      message: `Test run completed with status ${report.status}.`,
      counts: {
        pagesTested: report.summary.pagesTested,
        testsExecuted: report.summary.testsExecuted,
        issues: report.issues.length,
      },
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
}
