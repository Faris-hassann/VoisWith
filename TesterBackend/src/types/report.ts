import type { TestingType } from "../testing/test-types.js";
import type { LlmAttempt, LlmFailureReason } from "../errors/error-codes.js";
import type { TestAction } from "./ai.js";
import type { FormTestCase } from "./llm-contract.js";

export type RunStatus = "COMPLETED" | "STOPPED" | "ERRORED";
export type FindingsStatus = "PASSED" | "ISSUES_FOUND" | "INCONCLUSIVE";
export type LegacyStatus = "PASSED" | "FAILED" | "PARTIAL" | "ERROR" | "INCONCLUSIVE";
export type TestStatus =
  | "PASSED"
  | "FAILED"
  | "SKIPPED"
  | "BLOCKED_BY_POLICY"
  | "INCONCLUSIVE"
  | "ERROR";
export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
export type StoppedReason =
  | "converged"
  | "page_budget"
  | "depth_budget"
  | "time_budget"
  | "user_stopped"
  | "error";

export interface TestingRunResponse {
  runId: string;
  runStatus: RunStatus;
  findingsStatus: FindingsStatus;
  status: LegacyStatus;
  startedAt: string;
  completedAt: string;
  targetOrigin: string;
  selectedTestingTypes: TestingType[];
  stoppedReason?: StoppedReason;
  summary: RunSummary;
  pages: PageReport[];
  issues: Issue[];
  coverageLimitations: CoverageLimitation[];
  artifacts: EvidenceReference[];
  diagnostics?: RunDiagnostics;
}

export interface RunSummary {
  pagesDiscovered: number;
  pagesTested: number;
  pagesSkipped: number;
  testsExecuted: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  blockedByPolicy: number;
  inconclusiveTests: number;
  consoleErrors: number;
  failedNetworkRequests: number;
  artifactsBytes: number;
}

export interface PageReport {
  url: string;
  canonicalUrl: string;
  stateFingerprint?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  direction?: "ltr" | "rtl";
  status: TestStatus;
  tests: TestCaseResult[];
  consoleErrors: ConsoleObservation[];
  failedNetworkRequests: NetworkObservation[];
  performanceObservations: PerformanceObservation[];
  evidence: EvidenceReference[];
  skippedReason?: string;
  /** Plan-only this phase (Phase 4 adds execution/assertion) — never counted in RunSummary.testsExecuted. */
  plannedTestCases?: FormTestCase[];
}

export interface TestCaseResult {
  id: string;
  name: string;
  type: TestingType;
  status: TestStatus;
  priority?: string;
  steps: TestStepResult[];
  assertions: AssertionResult[];
  expectedResult?: string;
  actualResult?: string;
  error?: string;
  evidence: EvidenceReference[];
  reproductionSteps: string[];
  severity?: IssueSeverity;
  confidence?: number;
}

export interface TestStepResult {
  action: TestAction;
  status: TestStatus;
  expectedResult?: string;
  actualResult?: string;
  error?: string;
  evidence?: EvidenceReference[];
}

export type AssertionResult = TestStepResult;

export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  pageUrl?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  testName?: string;
  evidence: EvidenceReference[];
  confidence: number;
}

export interface NetworkObservation {
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  durationMs?: number;
  failureReason?: string;
  sameOrigin: boolean;
  appearsApiRequest: boolean;
  duplicateKey?: string;
}

export interface ConsoleObservation {
  type: string;
  text: string;
  location?: string;
}

export interface PerformanceObservation {
  name: string;
  valueMs?: number;
  description: string;
}

export interface EvidenceReference {
  id: string;
  type: "screenshot" | "trace" | "network" | "console" | "report" | "download" | "fixture";
  path: string;
  description?: string;
  /** On-disk size, recorded by the artifact manager. Feeds RunSummary.artifactsBytes. */
  sizeBytes?: number;
}

export interface SkippedPage {
  url: string;
  reason: string;
}

export interface BlockedAction {
  pageUrl: string;
  testName: string;
  action: TestAction;
  reason: string;
}

export interface CoverageLimitation {
  testType: TestingType;
  availability: "implemented" | "partial" | "planned";
  executed: boolean;
  reason: string;
}

export interface RunDiagnostics {
  runId: string;
  targetUrl: string;
  finalUrl?: string;
  startedAt: string;
  completedAt?: string;
  browser: {
    launched: boolean;
    error?: string;
  };
  matrix?: {
    roles: string[];
    viewports: string[];
    locales: string[];
  };
  authorization?: {
    comparisons: Array<{
      role: string;
      comparedTo: string;
      sharedUrls: number;
      uniqueUrls: string[];
      uniqueElements: number;
      status: TestStatus;
      message: string;
    }>;
  };
  initialNavigation?: DiagnosticEvent;
  login: {
    status: "SKIPPED" | "PASSED" | "FAILED" | "HUMAN_REQUIRED";
    message: string;
    details?: unknown;
    evidence?: EvidenceReference[];
  };
  crawl: {
    acceptedUrls: string[];
    skippedUrls: Array<{ url: string; reason: string }>;
    failedUrls: Array<{ url: string; reason: string }>;
    discoveredCandidates: number;
    noInternalLinksPages: string[];
    events: DiagnosticEvent[];
  };
  pages: PageDiagnostics[];
  ai: {
    calls: number;
    maxCalls: number;
    disabled: boolean;
    openRouterConfigured: boolean;
    modelConfigured: boolean;
    /** The 3 pinned model slugs, tried in order. Undefined when AI is not configured. */
    models?: string[];
    successes: number;
    failures: Array<{ pageUrl?: string; message: string; reason?: LlmFailureReason; attempts?: LlmAttempt[] }>;
    validationFailures: Array<{ pageUrl?: string; message: string; reason?: LlmFailureReason; attempts?: LlmAttempt[] }>;
    /** DESIGN-DECISIONS.md §5: MAX_AI_TEST_CASES_PER_RUN, run-wide across AI and deterministic-fallback cases alike. */
    maxTestCases: number;
    testCasesGenerated: number;
    /** Cases that would have exceeded maxTestCases; reported as truncated_by_budget in coverageLimitations, never silently dropped. */
    testCasesDropped: number;
    /** Number of batches that exhausted the 3-model chain and fell through to the deterministic generator. */
    deterministicFallbacks: number;
  };
}

export interface PageDiagnostics {
  url: string;
  finalUrl?: string;
  stateFingerprint?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  direction?: "ltr" | "rtl";
  status: TestStatus;
  navigationMs?: number;
  links: number;
  internalLinks: number;
  forms: number;
  buttons: number;
  inputs: number;
  consoleErrors: number;
  networkFailures: number;
  apiCalls: number;
  images: number;
  scripts: number;
  baselineTests: number;
  aiPlannedTests: number;
  reportArtifactPath?: string;
}

export interface DiagnosticEvent {
  name: string;
  status: "STARTED" | "PASSED" | "FAILED" | "SKIPPED" | "INFO";
  timestamp: string;
  url?: string;
  message?: string;
  durationMs?: number;
}
