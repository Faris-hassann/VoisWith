import { z } from "zod";
import { TEST_TYPES } from "../testing/test-types.js";

export const runStatusSchema = z.enum(["COMPLETED", "STOPPED", "ERRORED"]);
export const findingsStatusSchema = z.enum(["PASSED", "ISSUES_FOUND", "INCONCLUSIVE"]);
export const reportStatusSchema = z.enum(["PASSED", "FAILED", "PARTIAL", "ERROR", "INCONCLUSIVE"]);
export const testStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "SKIPPED",
  "BLOCKED_BY_POLICY",
  "INCONCLUSIVE",
  "ERROR",
]);
export const stoppedReasonSchema = z.enum([
  "converged",
  "page_budget",
  "depth_budget",
  "time_budget",
  "user_stopped",
  "error",
]);

export const runSummarySchema = z
  .object({
    pagesDiscovered: z.number().int().nonnegative(),
    pagesTested: z.number().int().nonnegative(),
    pagesSkipped: z.number().int().nonnegative(),
    pagesNotReached: z.number().int().nonnegative(),
    testsExecuted: z.number().int().nonnegative(),
    passedTests: z.number().int().nonnegative(),
    failedTests: z.number().int().nonnegative(),
    skippedTests: z.number().int().nonnegative(),
    blockedByPolicy: z.number().int().nonnegative(),
    inconclusiveTests: z.number().int().nonnegative(),
    consoleErrors: z.number().int().nonnegative(),
    failedNetworkRequests: z.number().int().nonnegative(),
    artifactsBytes: z.number().int().nonnegative(),
  })
  .strict();

export const coverageLimitationSchema = z
  .object({
    testType: z.enum(TEST_TYPES),
    availability: z.enum(["implemented", "partial", "planned"]),
    executed: z.boolean(),
    reason: z.string().min(1),
  })
  .strict();

export const testingRunResponseSchema = z
  .object({
    runId: z.string(),
    runStatus: runStatusSchema,
    findingsStatus: findingsStatusSchema,
    status: reportStatusSchema,
    startedAt: z.string(),
    completedAt: z.string(),
    targetOrigin: z.string(),
    selectedTestingTypes: z.array(z.enum(TEST_TYPES)),
    stoppedReason: stoppedReasonSchema.optional(),
    summary: runSummarySchema,
    pages: z.array(z.unknown()),
    issues: z.array(z.unknown()),
    coverageLimitations: z.array(coverageLimitationSchema),
    artifacts: z.array(z.unknown()),
    diagnostics: z.unknown().optional(),
  })
  .strict();
