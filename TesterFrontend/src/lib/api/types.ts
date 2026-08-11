export const TEST_TYPES = [
  "SMOKE",
  "PAGE_DISCOVERY",
  "NAVIGATION",
  "LINKS",
  "FORMS",
  "FORM_VALIDATION",
  "POSITIVE",
  "NEGATIVE",
  "BOUNDARY",
  "AUTHENTICATION",
  "SESSION",
  "AUTHORIZATION",
  "END_TO_END",
  "BUSINESS_RULES",
  "API_NETWORK",
  "ERROR_HANDLING",
  "FILE_UPLOAD_SAFE",
  "DATA_INTEGRITY_OBSERVABLE",
  "PERFORMANCE_BASIC",
  "RELIABILITY_BASIC",
  "CHROMIUM_COMPATIBILITY",
  "PASSIVE_SECURITY",
  "REGRESSION_BASELINE",
  "CONSOLE_ERRORS",
  "ACCESSIBILITY_TECHNICAL",
] as const;

export const IMPLEMENTED_TEST_TYPES = [
  "SMOKE",
  "PAGE_DISCOVERY",
  "NAVIGATION",
  "LINKS",
  "FORMS",
  "FORM_VALIDATION",
  "AUTHENTICATION",
  "API_NETWORK",
  "ERROR_HANDLING",
  "PERFORMANCE_BASIC",
  "CONSOLE_ERRORS",
  "ACCESSIBILITY_TECHNICAL",
  "PASSIVE_SECURITY",
] as const;

export const DEFAULT_ENABLED_TEST_TYPES = [
  "SMOKE",
  "PAGE_DISCOVERY",
  "NAVIGATION",
  "LINKS",
  "FORMS",
  "FORM_VALIDATION",
  "AUTHENTICATION",
  "API_NETWORK",
  "ERROR_HANDLING",
  "PERFORMANCE_BASIC",
  "CONSOLE_ERRORS",
  "ACCESSIBILITY_TECHNICAL",
] as const;

export const PARTIAL_TEST_TYPES = [
  "SESSION",
  "AUTHORIZATION",
  "CHROMIUM_COMPATIBILITY",
] as const;

export const PLANNED_TEST_TYPES = [
  "POSITIVE",
  "NEGATIVE",
  "BOUNDARY",
  "END_TO_END",
  "BUSINESS_RULES",
  "FILE_UPLOAD_SAFE",
  "DATA_INTEGRITY_OBSERVABLE",
  "RELIABILITY_BASIC",
  "REGRESSION_BASELINE",
] as const;

export type TestingType = (typeof TEST_TYPES)[number];
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

export interface TestingRunRequest {
  targetUrl: string;
  authorizationConfirmed: true;
  writeActionsAcknowledged?: boolean;
  selectedTestTypes?: string[];
  allowedOrigins?: string[];
  includeSubdomains?: boolean;
  browserMode?: "headed" | "headless";
  visualizationMode?: "local" | "live" | "off";
  testData?: Record<string, unknown>;
  credentials?: {
    enabled?: boolean;
    loginUrl?: string;
    username: string;
    password: string;
    fieldHints?: {
      usernameSelector?: string;
      passwordSelector?: string;
      submitSelector?: string;
    };
  };
  testTypes: TestingType[];
  crawl: {
    strategy: "DFS";
    maxDepth?: number;
    maxPages?: number;
    sameOriginOnly: boolean;
    includePatterns: string[];
    excludePatterns: string[];
    ignoredQueryParameters?: string[];
  };
  browser: {
    channel: "chrome";
    headless: boolean;
    viewport: {
      width: number;
      height: number;
    };
  };
  execution: {
    safeMode: boolean;
    allowFormSubmission: boolean;
    allowFileUploads: boolean;
    allowDestructiveActions: boolean;
    allowPayments: boolean;
    maximumActionsPerPage: number;
    maximumRunDurationSeconds: number;
  };
}

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

export type AsyncRunStatus = "queued" | "running" | "paused" | "stopping" | "stopped" | "completed" | "failed";
export type RunProgressStatus = "started" | "passed" | "failed" | "skipped" | "info" | "blocked";

export interface AsyncRunStartResponse {
  runId: string;
  status: AsyncRunStatus;
  startedAt: string;
  streamUrl: string;
}

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

export interface RunHistoryItem {
  runId: string;
  targetOrigin: string;
  runStatus: RunStatus;
  findingsStatus: FindingsStatus;
  status: LegacyStatus;
  stoppedReason?: StoppedReason;
  startedAt: string;
  completedAt: string;
  summary: RunSummary;
  issueCount: number;
  artifactsBytes: number;
}

export interface RunHistoryResponse {
  runs: RunHistoryItem[];
}

export interface RunSummary {
  pagesDiscovered: number;
  pagesTested: number;
  pagesSkipped: number;
  pagesNotReached: number;
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
  /** Plan-only: AI/deterministic form test cases planned but not executed. Never counted in RunSummary.testsExecuted. */
  plannedTestCases?: FormTestCase[];
}

/** The five-value outcome enum an AI or deterministic planner may request. INCONCLUSIVE is result-only, never requestable. */
export type ExpectedOutcomeKind = "VALIDATION_ERROR" | "FIELD_ERROR" | "SUBMIT_ACCEPTED" | "NO_NAVIGATION" | "ERROR_MESSAGE_SHOWN";

export interface FormTestCase {
  caseId: string;
  formId: string;
  testType: TestingType;
  intent: string;
  inputs: Array<{ elementId: string; value: string }>;
  submit: boolean;
  expectedOutcome: { kind: ExpectedOutcomeKind; elementId?: string };
}

export interface TestCaseResult {
  id: string;
  name: string;
  type: TestingType;
  status: TestStatus;
  priority?: string;
  steps: TestStepResult[];
  assertions: TestStepResult[];
  expectedResult?: string;
  actualResult?: string;
  error?: string;
  evidence: EvidenceReference[];
  reproductionSteps: string[];
  severity?: IssueSeverity;
  confidence?: number;
}

export interface TestStepResult {
  action: {
    action: string;
    elementId?: string;
    valueStrategy?: string;
    description?: string;
    expectedText?: string;
    expectedUrl?: string;
  };
  status: TestStatus;
  expectedResult?: string;
  actualResult?: string;
  error?: string;
  evidence?: EvidenceReference[];
}

export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  fingerprint?: string;
  occurrenceCount?: number;
  failedTestCount?: number;
  affectedPages?: string[];
  relatedTestTypes?: TestingType[];
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
  /** On-disk size recorded by the backend. Feeds RunSummary.artifactsBytes. */
  sizeBytes?: number;
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
    provider?: "qwen";
    providerConfigured?: boolean;
    calls: number;
    maxCalls?: number;
    disabled?: boolean;
    successes: number;
    failures: Array<{ pageUrl?: string; message: string; reason?: string; attempts?: Array<{ model: string; reason: string; message: string }> }>;
    validationFailures: Array<{ pageUrl?: string; message: string; reason?: string; attempts?: Array<{ model: string; reason: string; message: string }> }>;
    /** Run-wide MAX_AI_TEST_CASES_PER_RUN, across AI and deterministic-fallback cases alike. */
    maxTestCases?: number;
    testCasesGenerated?: number;
    /** Cases that would have exceeded maxTestCases; reported as truncated_by_budget in coverageLimitations. */
    testCasesDropped?: number;
    deterministicFallbacks?: number;
  };
}

export interface PageDiagnostics {
  url: string;
  finalUrl?: string;
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
  apiCalls?: number;
  images?: number;
  scripts?: number;
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
