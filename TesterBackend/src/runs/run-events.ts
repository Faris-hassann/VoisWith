import type { TestingRunResponse } from "../types/report.js";
import type { FormTestCase } from "../types/llm-contract.js";

export type FormTestCaseStateStatus =
  | "planned"
  | "running"
  | "holding"
  | "submitting"
  | "passed"
  | "failed"
  | "inconclusive";

export interface FormTestCaseState {
  runId: string;
  caseId: string;
  formId: string;
  pageUrl: string;
  role?: string;
  viewport?: string;
  locale?: string;
  planningSource: "ai" | "deterministic" | "mixed";
  testCase: FormTestCase;
  status: FormTestCaseStateStatus;
  submit: boolean;
  selectedButton?: string;
  holdStartedAt?: string;
  holdDurationSeconds?: number;
  holdRemainingSeconds?: number;
  resultStatus?: TestingRunResponse["pages"][number]["tests"][number]["status"];
  resultMessage?: string;
}

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
  formTestCase?: FormTestCaseState;
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
  formTestCases?: FormTestCaseState[];
  report?: TestingRunResponse;
  error?: unknown;
}
