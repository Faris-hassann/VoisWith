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

export type TestingType = (typeof TEST_TYPES)[number];
export type RunStatus = "PASSED" | "FAILED" | "PARTIAL" | "ERROR" | "INCONCLUSIVE";
export type TestStatus =
  | "PASSED"
  | "FAILED"
  | "SKIPPED"
  | "BLOCKED_BY_POLICY"
  | "INCONCLUSIVE"
  | "ERROR";
export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

export interface TestingRunRequest {
  targetUrl: string;
  authorizationConfirmed: true;
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
  status: RunStatus;
  startedAt: string;
  completedAt: string;
  targetOrigin: string;
  selectedTestingTypes: TestingType[];
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
  liveFrame?: {
    mimeType: "image/jpeg" | "image/png";
    data: string;
    pageUrl?: string;
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
}

export interface CoverageLimitation {
  area: string;
  reason: string;
  recommendation?: string;
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
    calls: number;
    maxCalls?: number;
    disabled?: boolean;
    openRouterConfigured?: boolean;
    modelConfigured?: boolean;
    model?: string;
    successes: number;
    failures: Array<{ pageUrl?: string; message: string }>;
    validationFailures: Array<{ pageUrl?: string; message: string }>;
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
