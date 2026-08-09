import { z } from "zod";
import { TEST_TYPES } from "../testing/test-types.js";
import {
  ELEMENT_ID_PATTERN,
  EXPECTED_OUTCOMES,
  MAX_GENERATED_VALUE_LENGTH,
  MAX_SELECT_OPTIONS,
  type FormSnapshot,
} from "../types/llm-contract.js";

const elementIdSchema = z.string().regex(ELEMENT_ID_PATTERN, "elementId must match element_<n>");

const formFieldSnapshotSchema = z
  .object({
    elementId: elementIdSchema,
    kind: z.enum(["input", "textarea", "select", "checkbox", "radio", "file", "search", "other"]),
    type: z.string().max(50).optional(),
    label: z.string().max(300).optional(),
    placeholder: z.string().max(300).optional(),
    name: z.string().max(200).optional(),
    required: z.boolean(),
    disabled: z.boolean(),
    minLength: z.number().int().optional(),
    maxLength: z.number().int().optional(),
    min: z.string().max(100).optional(),
    max: z.string().max(100).optional(),
    pattern: z.string().max(300).optional(),
    options: z.array(z.string().max(300)).max(MAX_SELECT_OPTIONS).optional(),
  })
  .strict();

export const formSnapshotSchema = z
  .object({
    formId: z.string().min(1).max(100),
    elementId: elementIdSchema,
    method: z.string().max(20).optional(),
    routeFamily: z.string().max(500).optional(),
    apparentPurpose: z.string().max(500).optional(),
    fields: z.array(formFieldSnapshotSchema).max(100),
    submitLabel: z.string().max(300).optional(),
  })
  .strict();

const formFieldValueSchema = z
  .object({
    elementId: elementIdSchema,
    value: z.string().max(MAX_GENERATED_VALUE_LENGTH),
  })
  .strict();

const formExpectedOutcomeSchema = z
  .object({
    kind: z.enum(EXPECTED_OUTCOMES),
    elementId: elementIdSchema.optional(),
  })
  .strict();

/** Hard cap per DESIGN-DECISIONS.md §5: prompt asks for 5-8, validator caps at 12. */
export const MAX_VALIDATED_CASES_PER_FORM = 12;

const formTestCaseSchema = z
  .object({
    caseId: z.string().min(1).max(100),
    formId: z.string().min(1).max(100),
    testType: z.enum(TEST_TYPES),
    intent: z.string().max(1000),
    inputs: z.array(formFieldValueSchema).max(100),
    submit: z.boolean(),
    expectedOutcome: formExpectedOutcomeSchema,
  })
  .strict();

/**
 * Shape-only plan schema. Every object boundary is `.strict()`, so any key the
 * contract does not name — `selector`, `css`, `xpath`, `locator`, or anything
 * else the model invents — is a parse failure rather than a silently dropped
 * field.
 */
export const formTestPlanSchema = z
  .object({
    testCases: z.array(formTestCaseSchema).max(100),
  })
  .strict();

/**
 * Builds a plan schema bound to a specific batch: test cases may only reference
 * `formId`s and `elementId`s that were actually sent to the model, per form the
 * case is scoped to at most MAX_VALIDATED_CASES_PER_FORM (§5).
 */
export function buildFormTestPlanSchema(snapshots: FormSnapshot[]) {
  const formIds = new Set(snapshots.map((snapshot) => snapshot.formId));
  const elementIdsByForm = new Map(
    snapshots.map((snapshot) => [snapshot.formId, new Set(snapshot.fields.map((field) => field.elementId))]),
  );

  return formTestPlanSchema.superRefine((plan, ctx) => {
    const casesPerForm = new Map<string, number>();

    plan.testCases.forEach((testCase, testCaseIndex) => {
      if (!formIds.has(testCase.formId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["testCases", testCaseIndex, "formId"],
          message: `formId "${testCase.formId}" was not present in the input snapshots.`,
        });
        return;
      }

      const countSoFar = (casesPerForm.get(testCase.formId) ?? 0) + 1;
      casesPerForm.set(testCase.formId, countSoFar);
      if (countSoFar > MAX_VALIDATED_CASES_PER_FORM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["testCases", testCaseIndex],
          message: `formId "${testCase.formId}" exceeds the ${MAX_VALIDATED_CASES_PER_FORM}-case-per-form cap.`,
        });
        return;
      }

      const allowedElementIds = elementIdsByForm.get(testCase.formId) ?? new Set<string>();
      testCase.inputs.forEach((input, inputIndex) => {
        if (!allowedElementIds.has(input.elementId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["testCases", testCaseIndex, "inputs", inputIndex, "elementId"],
            message: `elementId "${input.elementId}" is not a field of form "${testCase.formId}".`,
          });
        }
      });

      const outcomeElementId = testCase.expectedOutcome.elementId;
      if (outcomeElementId && !allowedElementIds.has(outcomeElementId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["testCases", testCaseIndex, "expectedOutcome", "elementId"],
          message: `elementId "${outcomeElementId}" is not a field of form "${testCase.formId}".`,
        });
      }
    });
  });
}
