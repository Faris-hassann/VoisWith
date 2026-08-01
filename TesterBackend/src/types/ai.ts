import type { TestingType } from "../testing/test-types.js";

export const ACTION_TYPES = [
  "NAVIGATE",
  "CLICK",
  "FILL",
  "CLEAR",
  "SELECT",
  "CHECK",
  "UNCHECK",
  "PRESS_KEY",
  "UPLOAD_SAFE_FIXTURE",
  "SUBMIT",
  "WAIT_FOR",
  "ASSERT_VISIBLE",
  "ASSERT_HIDDEN",
  "ASSERT_TEXT",
  "ASSERT_URL",
  "ASSERT_ENABLED",
  "ASSERT_DISABLED",
  "ASSERT_VALUE",
  "ASSERT_RESPONSE_STATUS",
  "EXTRACT_VALUE",
  "RELOAD",
  "GO_BACK",
  "STOP",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type TestPriority = "HIGH" | "MEDIUM" | "LOW";

export interface TestPlan {
  pageSummary: string;
  identifiedPurpose: string;
  risks: string[];
  testCases: TestCase[];
  additionalLinksToPrioritize: string[];
  pageTestingComplete: boolean;
}

export interface TestCase {
  id: string;
  name: string;
  type: TestingType;
  priority: TestPriority;
  preconditions: string[];
  steps: TestAction[];
  assertions: TestAction[];
  cleanupActions: TestAction[];
  destructive: boolean;
  reasoningSummary: string;
}

export interface TestAction {
  action: ActionType;
  elementId?: string;
  url?: string;
  value?: string;
  valueStrategy?: string;
  expectedText?: string;
  expectedUrl?: string;
  key?: string;
  timeoutMs?: number;
  description?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  status: "APPROVED" | "BLOCKED_BY_POLICY";
}
