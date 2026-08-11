import { MAX_GENERATED_VALUE_LENGTH } from "../types/llm-contract.js";
import type { FormFieldSnapshot, FormSnapshot, FormTestCase } from "../types/llm-contract.js";
import { FormDataGenerator } from "./form-data-generator.js";
import { inferFieldIntent } from "./field-intent.js";

/** Matches the validator's per-form cap so a form never overflows even before validation. */
const MAX_CASES_PER_FORM = 12;

/**
 * The last rung of the retry ladder (DESIGN-DECISIONS.md §5): when the model
 * chain exhausts, planning still produces safe, schema-valid test cases from
 * the deterministic generator rather than nothing at all.
 */
export function generateDeterministicPlan(
  snapshots: FormSnapshot[],
  runId: string,
  allowFormSubmission: boolean,
  targetHost = "example",
): FormTestCase[] {
  const generator = new FormDataGenerator(runId, targetHost);
  return snapshots.flatMap((snapshot) => generateFormCases(snapshot, generator, allowFormSubmission));
}

function generateFormCases(
  snapshot: FormSnapshot,
  generator: FormDataGenerator,
  allowFormSubmission: boolean,
): FormTestCase[] {
  const cases: FormTestCase[] = [];
  const fillableFields = snapshot.fields.filter(isFillable);
  const requiredField = snapshot.fields.find((field) => field.required);
  let index = 0;
  const nextCaseId = () => `det-${snapshot.formId.slice(0, 8)}-${++index}`;

  cases.push({
    caseId: nextCaseId(),
    formId: snapshot.formId,
    testType: "FORM_VALIDATION",
    intent: "Empty required fields block submission.",
    inputs: [],
    submit: allowFormSubmission,
    expectedOutcome: requiredField
      ? { kind: "VALIDATION_ERROR", elementId: requiredField.elementId }
      : { kind: "NO_NAVIGATION" },
  });

  for (const field of fillableFields) {
    if (cases.length >= MAX_CASES_PER_FORM) break;
    const strategy = invalidStrategy(field);
    if (!strategy) continue;
    cases.push({
      caseId: nextCaseId(),
      formId: snapshot.formId,
      testType: "FORM_VALIDATION",
      intent: `Invalid value in "${field.label ?? field.name ?? field.elementId}" is rejected.`,
      inputs: fillableFields.map((candidate) => ({
        elementId: candidate.elementId,
        value: clamp(generator.value(candidate.elementId === field.elementId ? strategy : validStrategy(candidate))),
      })),
      submit: allowFormSubmission,
      expectedOutcome: allowFormSubmission
        ? { kind: "FIELD_ERROR", elementId: field.elementId }
        : { kind: "NO_NAVIGATION" },
    });
  }

  if (fillableFields.length > 0 && cases.length < MAX_CASES_PER_FORM) {
    cases.push({
      caseId: nextCaseId(),
      formId: snapshot.formId,
      testType: "FORMS",
      intent: "Valid values across all visible fields.",
      inputs: fillableFields.map((field) => ({
        elementId: field.elementId,
        value: clamp(generator.value(validStrategy(field))),
      })),
      submit: allowFormSubmission,
      expectedOutcome: allowFormSubmission ? { kind: "SUBMIT_ACCEPTED" } : { kind: "NO_NAVIGATION" },
    });
  }

  return cases.slice(0, MAX_CASES_PER_FORM);
}

function isFillable(field: FormFieldSnapshot): boolean {
  return !field.disabled && (field.kind === "input" || field.kind === "textarea" || field.kind === "search");
}

function invalidStrategy(field: FormFieldSnapshot): string | undefined {
  const intent = inferFieldIntent(field);
  if (intent === "email") return "INVALID_EMAIL";
  if (intent === "phone") return "INVALID_PHONE";
  if (typeof field.maxLength === "number") return "TOO_LONG";
  if (typeof field.minLength === "number" && field.minLength > 0) return "TOO_SHORT";
  return undefined;
}

function validStrategy(field: FormFieldSnapshot): string | undefined {
  const intent = inferFieldIntent(field);
  if (intent === "email") return "VALID_EMAIL";
  if (intent === "phone") return "VALID_PHONE";
  if (intent === "postal") return "VALID_POSTAL_CODE";
  if (intent === "first_name") return "VALID_FIRST_NAME";
  if (intent === "last_name") return "VALID_LAST_NAME";
  if (intent === "full_name") return "VALID_FULL_NAME";
  if (intent === "company") return "VALID_COMPANY";
  if (intent === "address") return "VALID_ADDRESS";
  if (intent === "description") return "VALID_DESCRIPTION";
  if (intent === "password") return "VALID_PASSWORD";
  if (intent === "date") return "VALID_DATE";
  if (intent === "number") return "VALID_NUMBER";
  return undefined;
}

function clamp(value: string): string {
  return value.slice(0, MAX_GENERATED_VALUE_LENGTH);
}
