import type { TestingRunResponse } from "../types/report.js";

export type AsyncRunStatus = "queued" | "running" | "paused" | "stopping" | "stopped" | "completed" | "failed";
export type RunProgressStatus = "started" | "passed" | "failed" | "skipped" | "info" | "blocked";

export interface RunProgressEvent {
  runId: string;
  sequence: number;
  type: string;
  status: RunProgressStatus;
  timestamp: string;
  message: string;
  pageUrl?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  counts?: Record<string, number>;
  diagnostics?: unknown;
  issue?: unknown;
  stoppedReason?: TestingRunResponse["stoppedReason"];
  liveFrame?: {
    mimeType: "image/jpeg" | "image/png";
    data: string;
    pageUrl?: string;
  };
  liveCursor?: {
    x: number;
    y: number;
    action: "move" | "click" | "scroll";
  };
  report?: TestingRunResponse;
}

export type RunProgressEventInput = Omit<RunProgressEvent, "sequence" | "timestamp"> & {
  timestamp?: string;
};

export type RunEventSink = (event: RunProgressEventInput) => void;

export interface AsyncRunSnapshot {
  runId: string;
  status: AsyncRunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  events: RunProgressEvent[];
  report?: TestingRunResponse;
  error?: unknown;
}
