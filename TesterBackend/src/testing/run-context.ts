import type { TestingRunRequest } from "../types/testing.js";
import type { PageReport, RunDiagnostics } from "../types/report.js";

export interface RunContext {
  runId: string;
  startedAt: string;
  targetOrigin: string;
  request: TestingRunRequest;
  visitedUrls: Set<string>;
  pendingUrls: Set<string>;
  skippedUrls: Map<string, string>;
  failedUrls: Map<string, string>;
  redirectHistory: Map<string, string[]>;
  pageReports: PageReport[];
  previousPageSummaries: string[];
  previousTestResults: string[];
  knownWorkflows: string[];
  generatedEntities: string[];
  openRouterCalls: number;
  deadlineMs: number;
  artifactRoot: string;
  diagnostics: RunDiagnostics;
}
