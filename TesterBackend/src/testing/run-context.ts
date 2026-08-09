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
  /** Visit count per route family, enforcing §9's 3-instances-per-family budget. */
  routeFamilies?: Map<string, number>;
  /** formId → first page URL that tested it, enforcing §7's one-form-tested-once rule. */
  processedForms?: Map<string, string>;
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
  /**
   * Set by the crawler when it exits, before the report aggregator reads it.
   * Precedence when multiple conditions apply: error > user_stopped >
   * time_budget > page_budget > depth_budget > converged.
   * See DESIGN-DECISIONS.md §3, §9.
   */
  stoppedReason?: StoppedReason;
  control?: {
    isStopped: () => boolean;
    waitWhilePaused: () => Promise<void>;
  };
  diagnostics: RunDiagnostics;
}
