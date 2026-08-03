import { z } from "zod";
import { ACTION_TYPES } from "../types/ai.js";
import { TEST_TYPES } from "../testing/test-types.js";

const testActionSchema = z
  .object({
    action: z.enum(ACTION_TYPES),
    elementId: z.string().regex(/^element_\d+$/).optional(),
    url: z.string().url().optional(),
    value: z.string().max(2000).optional(),
    valueStrategy: z.string().max(100).optional(),
    expectedText: z.string().max(2000).optional(),
    expectedUrl: z.string().url().optional(),
    key: z.string().max(50).optional(),
    timeoutMs: z.number().int().min(0).max(60000).optional(),
    description: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((action, ctx) => {
    const pageLevelActions = new Set(["NAVIGATE", "ASSERT_URL", "RELOAD", "GO_BACK", "STOP", "WAIT_FOR"]);
    if (!pageLevelActions.has(action.action) && !action.elementId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${action.action} requires an inspector-produced elementId`,
        path: ["elementId"],
      });
    }
  });

const testCaseSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    type: z.enum(TEST_TYPES),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
    preconditions: z.array(z.string().max(300)).max(20),
    steps: z.array(testActionSchema).max(100),
    assertions: z.array(testActionSchema).max(100),
    cleanupActions: z.array(testActionSchema).max(20),
    destructive: z.boolean(),
    reasoningSummary: z.string().max(1000),
  })
  .strict();

export const aiTestPlanSchema = z
  .object({
    pageSummary: z.string().max(2000),
    identifiedPurpose: z.string().max(1000),
    risks: z.array(z.string().max(500)).max(30),
    testCases: z.array(testCaseSchema).max(100),
    additionalLinksToPrioritize: z.array(z.string().url()).max(50),
    pageTestingComplete: z.boolean(),
  })
  .strict();
