import type { TestingRunRequest } from "../types/testing.js";
import type { PageReport, RunDiagnostics, StoppedReason } from "../types/report.js";

export interface RunContext {
  runId: string;
  startedAt: string;
  targetOrigin: string;
  roleName?: string;
  viewportName?: string;
  localeName?: string;
  direction?: "ltr" | "rtl";
  request: TestingRunRequest;
  visitedUrls: Set<string>;
  discoveredUrls?: Set<string>;
  visitedStates?: Set<string>;
  pendingUrls: Set<string>;
  pendingCrawlItems?: Set<string>;
  processedInteractions?: Set<string>;
  routeFamilies?: Map<string, number>;
  processedForms?: Map<string, string>;
  skippedUrls: Map<string, string>;
  externalUrls?: Map<string, { sourceUrl?: string; text?: string }>;
  failedUrls: Map<string, string>;
  redirectHistory: Map<string, string[]>;
  pageReports: PageReport[];
  previousPageSummaries: string[];
  previousTestResults: string[];
  knownWorkflows: string[];
  generatedEntities: string[];
  aiCalls?: number;
  deadlineMs: number;
  artifactRoot: string;
  stoppedReason?: StoppedReason;
  control?: {
    isStopped: () => boolean;
    waitWhilePaused: () => Promise<void>;
  };
  diagnostics: RunDiagnostics;
}
