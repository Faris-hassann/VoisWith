import type { TestingType } from "../testing/test-types.js";
import type { TestAction } from "./ai.js";

export type RunStatus = "PASSED" | "FAILED" | "PARTIAL" | "ERROR" | "INCONCLUSIVE";
export type TestStatus =
  | "PASSED"
  | "FAILED"
  | "SKIPPED"
  | "BLOCKED_BY_POLICY"
  | "INCONCLUSIVE"
  | "ERROR";
export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

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
  area: string;
  reason: string;
  recommendation?: string;
}
