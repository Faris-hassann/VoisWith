import { describe, expect, it } from "vitest";
import { validateFormTestPlan } from "../../src/ai/form-plan-validator.js";
import { formSnapshotSchema, MAX_VALIDATED_CASES_PER_FORM } from "../../src/schemas/llm-contract.schema.js";
import { LLM_FAILURE_REASONS } from "../../src/errors/error-codes.js";
import {
  EVALUATION_OUTCOMES,
  EXPECTED_OUTCOMES,
  MAX_GENERATED_VALUE_LENGTH,
  MAX_SELECT_OPTIONS,
  type FormSnapshot,
} from "../../src/types/llm-contract.js";

function snapshot(overrides: Partial<FormSnapshot> = {}): FormSnapshot {
  return {
    formId: "form_1",
    elementId: "element_1",
    method: "post",
    submitLabel: "Submit",
    fields: [
      { elementId: "element_2", kind: "input", type: "email", required: true, disabled: false },
      { elementId: "element_3", kind: "input", type: "text", required: false, disabled: false },
    ],
    ...overrides,
  };
}

function plan(testCase: Record<string, unknown> = {}) {
  return {
    testCases: [
      {
        caseId: "tc_1",
        formId: "form_1",
        testType: "FORM_VALIDATION",
        intent: "Confirm the email field validates format.",
        inputs: [{ elementId: "element_2", value: "not-an-email" }],
        submit: true,
        expectedOutcome: { kind: "VALIDATION_ERROR", elementId: "element_2" },
        ...testCase,
      },
    ],
  };
}

describe("expected outcome enums", () => {
  it("allows exactly five requestable outcomes", () => {
    expect([...EXPECTED_OUTCOMES]).toEqual([
      "VALIDATION_ERROR",
      "FIELD_ERROR",
      "SUBMIT_ACCEPTED",
      "NO_NAVIGATION",
      "ERROR_MESSAGE_SHOWN",
    ]);
  });

  it("keeps INCONCLUSIVE out of the requestable enum", () => {
    expect(EXPECTED_OUTCOMES).not.toContain("INCONCLUSIVE");
  });

  it("evaluates against a separate six-value space that adds INCONCLUSIVE", () => {
    expect(EVALUATION_OUTCOMES).toHaveLength(6);
    expect(EVALUATION_OUTCOMES).toContain("INCONCLUSIVE");
    for (const outcome of EXPECTED_OUTCOMES) {
      expect(EVALUATION_OUTCOMES).toContain(outcome);
    }
  });
});

describe("FormSnapshot schema", () => {
  it("accepts a sanitized snapshot", () => {
    expect(formSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });

  it(`caps select options at ${MAX_SELECT_OPTIONS}`, () => {
    const withinCap = Array.from({ length: MAX_SELECT_OPTIONS }, (_, index) => `option_${index}`);
    const overCap = [...withinCap, "one_too_many"];

    expect(
      formSnapshotSchema.safeParse(
        snapshot({ fields: [{ elementId: "element_2", kind: "select", required: false, disabled: false, options: withinCap }] }),
      ).success,
    ).toBe(true);

    expect(
      formSnapshotSchema.safeParse(
        snapshot({ fields: [{ elementId: "element_2", kind: "select", required: false, disabled: false, options: overCap }] }),
      ).success,
    ).toBe(false);
  });

  it("flattens validation constraints directly onto the field", () => {
    const result = formSnapshotSchema.safeParse(
      snapshot({
        fields: [
          { elementId: "element_2", kind: "input", required: false, disabled: false, maxLength: 64, pattern: "^[a-z]+$" },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a nested validation object (the pre-realignment shape)", () => {
    const result = formSnapshotSchema.safeParse(
      snapshot({
        fields: [
          { elementId: "element_2", kind: "input", required: false, disabled: false, validation: { maxLength: 64 } } as never,
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a submitLabel string and rejects a submitControls array", () => {
    expect(formSnapshotSchema.safeParse(snapshot({ submitLabel: "Request Service" })).success).toBe(true);
    expect(
      formSnapshotSchema.safeParse({ ...snapshot(), submitControls: [{ elementId: "element_4" }] } as never).success,
    ).toBe(false);
  });

  it("rejects selector-bearing keys on fields", () => {
    const result = formSnapshotSchema.safeParse(
      snapshot({
        fields: [
          { elementId: "element_2", kind: "input", required: false, disabled: false, locator: "#email" } as never,
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("LLM test plan validation", () => {
  it("accepts a plan that honours the contract", () => {
    const result = validateFormTestPlan(plan(), [snapshot()]);
    expect(result.ok).toBe(true);
  });

  it("accepts a page-scoped outcome with no elementId", () => {
    const result = validateFormTestPlan(
      plan({ expectedOutcome: { kind: "SUBMIT_ACCEPTED" } }),
      [snapshot()],
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["an unknown key", plan({ selector: "#email" })],
    ["a css selector key", plan({ css: "input[name=email]" })],
    ["an outcome kind outside the enum", plan({ expectedOutcome: { kind: "INCONCLUSIVE" } })],
    ["an invented outcome kind", plan({ expectedOutcome: { kind: "SOMETHING_ELSE" } })],
    ["a bare-string expectedOutcome (pre-realignment shape)", plan({ expectedOutcome: "VALIDATION_ERROR" })],
    ["a formId absent from the batch", plan({ formId: "form_99" })],
    ["an elementId absent from the form", plan({ inputs: [{ elementId: "element_77", value: "x" }] })],
    ["a malformed elementId", plan({ inputs: [{ elementId: "#email", value: "x" }] })],
    ["an expectedOutcome elementId absent from the form", plan({ expectedOutcome: { kind: "FIELD_ERROR", elementId: "element_99" } })],
    [
      "a value over the length cap",
      plan({ inputs: [{ elementId: "element_2", value: "x".repeat(MAX_GENERATED_VALUE_LENGTH + 1) }] }),
    ],
    ["a missing testType", (() => { const { testType: _testType, ...rest } = plan().testCases[0] as Record<string, unknown>; return { testCases: [rest] }; })()],
    ["a missing submit flag", (() => { const { submit: _submit, ...rest } = plan().testCases[0] as Record<string, unknown>; return { testCases: [rest] }; })()],
  ])("rejects %s as llm_schema_invalid", (_label, payload) => {
    const result = validateFormTestPlan(payload, [snapshot()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID);
    }
  });

  it(`accepts a value at exactly ${MAX_GENERATED_VALUE_LENGTH} characters`, () => {
    const result = validateFormTestPlan(
      plan({ inputs: [{ elementId: "element_2", value: "x".repeat(MAX_GENERATED_VALUE_LENGTH) }] }),
      [snapshot()],
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unknown keys at the plan boundary", () => {
    const result = validateFormTestPlan({ ...plan(), notes: "extra" }, [snapshot()]);
    expect(result.ok).toBe(false);
  });

  it("scopes element references to the form that owns them", () => {
    const other = snapshot({
      formId: "form_2",
      elementId: "element_5",
      fields: [{ elementId: "element_6", kind: "input", required: false, disabled: false }],
    });
    // element_6 belongs to form_2, so form_1 may not reference it.
    const result = validateFormTestPlan(plan({ inputs: [{ elementId: "element_6", value: "x" }] }), [
      snapshot(),
      other,
    ]);
    expect(result.ok).toBe(false);
  });

  it(`caps validated cases at ${MAX_VALIDATED_CASES_PER_FORM} per form`, () => {
    const testCases = Array.from({ length: MAX_VALIDATED_CASES_PER_FORM + 1 }, (_, index) => ({
      caseId: `tc_${index + 1}`,
      formId: "form_1",
      testType: "FORM_VALIDATION",
      intent: "Boundary case.",
      inputs: [],
      submit: false,
      expectedOutcome: { kind: "NO_NAVIGATION" },
    }));

    const withinCap = validateFormTestPlan({ testCases: testCases.slice(0, MAX_VALIDATED_CASES_PER_FORM) }, [snapshot()]);
    expect(withinCap.ok).toBe(true);

    const overCap = validateFormTestPlan({ testCases }, [snapshot()]);
    expect(overCap.ok).toBe(false);
  });
});
