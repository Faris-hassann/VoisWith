import { describe, expect, it } from "vitest";
import { generateDeterministicPlan } from "../../src/testing/deterministic-form-plan.js";
import { buildFormTestPlanSchema } from "../../src/schemas/llm-contract.schema.js";
import type { FormSnapshot } from "../../src/types/llm-contract.js";

const snapshot: FormSnapshot = {
  formId: "form_1",
  elementId: "element_1",
  routeFamily: "/contact",
  fields: [
    { elementId: "element_2", kind: "input", type: "email", label: "Email", required: true, disabled: false },
    { elementId: "element_3", kind: "input", type: "text", label: "Name", required: false, disabled: false, maxLength: 50 },
  ],
};

describe("generateDeterministicPlan", () => {
  it("produces output that validates against the batch's own contract schema", () => {
    const testCases = generateDeterministicPlan([snapshot], "run_1", true);

    const result = buildFormTestPlanSchema([snapshot]).safeParse({ testCases });

    expect(result.success).toBe(true);
  });

  it("never emits an elementId outside the snapshot", () => {
    const testCases = generateDeterministicPlan([snapshot], "run_1", true);
    const allowed = new Set(["element_2", "element_3"]);

    for (const testCase of testCases) {
      for (const input of testCase.inputs) {
        expect(allowed.has(input.elementId)).toBe(true);
      }
      if (testCase.expectedOutcome.elementId) {
        expect(allowed.has(testCase.expectedOutcome.elementId)).toBe(true);
      }
    }
  });

  it("never submits when form submission is not allowed", () => {
    const testCases = generateDeterministicPlan([snapshot], "run_1", false);

    expect(testCases.length).toBeGreaterThan(0);
    expect(testCases.every((testCase) => testCase.submit === false)).toBe(true);
  });

  it("flags the first required field as the empty-submission expectation", () => {
    const testCases = generateDeterministicPlan([snapshot], "run_1", true);
    const emptySubmission = testCases.find((testCase) => testCase.inputs.length === 0);

    expect(emptySubmission?.expectedOutcome).toEqual({ kind: "VALIDATION_ERROR", elementId: "element_2" });
  });

  it("produces deterministic, repeatable output for the same runId", () => {
    const first = generateDeterministicPlan([snapshot], "run_stable", true);
    const second = generateDeterministicPlan([snapshot], "run_stable", true);

    expect(first).toEqual(second);
  });

  it("infers email intent from metadata when type=text", () => {
    const semantic: FormSnapshot = {
      ...snapshot,
      fields: [{ elementId: "element_9", kind: "input", type: "text", label: "Work Email", required: false, disabled: false }],
    };
    const testCases = generateDeterministicPlan([semantic], "run_semantic", true, "target.example");

    expect(testCases.some((testCase) =>
      testCase.inputs.some((input) => input.elementId === "element_9" && input.value === "not-an-email") &&
      testCase.expectedOutcome.kind === "FIELD_ERROR" && testCase.expectedOutcome.elementId === "element_9",
    )).toBe(true);
    expect(testCases.flatMap((testCase) => testCase.inputs).map((input) => input.value)).toContain(
      "qa+run_semantic@target.example.test",
    );
  });

  it("uses canonical greppable test values", () => {
    const values = generateDeterministicPlan([snapshot], "run_marker", true, "example.com")
      .flatMap((testCase) => testCase.inputs)
      .map((input) => input.value);
    expect(values.some((value) => value.includes("ZZTEST-run_marker"))).toBe(true);
    expect(values).toContain("qa+run_marker@example.com.test");
  });
});
