import { z } from "zod";
import { TEST_TYPES } from "../testing/test-types.js";

export const reportStatusSchema = z.enum(["PASSED", "FAILED", "PARTIAL", "ERROR", "INCONCLUSIVE"]);
export const testStatusSchema = z.enum([
  "PASSED",
  "FAILED",
  "SKIPPED",
  "BLOCKED_BY_POLICY",
  "INCONCLUSIVE",
  "ERROR",
]);

export const runSummarySchema = z
  .object({
    pagesDiscovered: z.number().int().nonnegative(),
    pagesTested: z.number().int().nonnegative(),
    pagesSkipped: z.number().int().nonnegative(),
    testsExecuted: z.number().int().nonnegative(),
    passedTests: z.number().int().nonnegative(),
    failedTests: z.number().int().nonnegative(),
    skippedTests: z.number().int().nonnegative(),
    blockedByPolicy: z.number().int().nonnegative(),
    inconclusiveTests: z.number().int().nonnegative(),
    consoleErrors: z.number().int().nonnegative(),
    failedNetworkRequests: z.number().int().nonnegative(),
  })
  .strict();

export const testingRunResponseSchema = z
  .object({
    runId: z.string(),
    status: reportStatusSchema,
    startedAt: z.string(),
    completedAt: z.string(),
    targetOrigin: z.string(),
    selectedTestingTypes: z.array(z.enum(TEST_TYPES)),
    summary: runSummarySchema,
    pages: z.array(z.unknown()),
    issues: z.array(z.unknown()),
    coverageLimitations: z.array(z.unknown()),
    artifacts: z.array(z.unknown()),
  })
  .strict();
