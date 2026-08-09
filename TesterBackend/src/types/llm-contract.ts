import type { TestingType } from "../testing/test-types.js";

/**
 * The LLM boundary contract.
 *
 * Everything here is either sent to or accepted from the model. Nothing in this
 * module may carry a selector, a locator, or a raw user value: the model plans
 * against opaque `element_N` identifiers only, and the executor resolves those
 * back to real elements through the inspector's own locator descriptors.
 *
 * Shapes follow DESIGN-DECISIONS.md §3 exactly. See §5, §6 for the caps and
 * failure taxonomy referenced below.
 */

/**
 * The only outcomes an LLM is allowed to request.
 *
 * INCONCLUSIVE is deliberately absent — it is a result the assertion engine may
 * *observe*, never an expectation a test may be written against.
 */
export const EXPECTED_OUTCOMES = [
  "VALIDATION_ERROR",
  "FIELD_ERROR",
  "SUBMIT_ACCEPTED",
  "NO_NAVIGATION",
  "ERROR_MESSAGE_SHOWN",
] as const;

export type ExpectedOutcome = (typeof EXPECTED_OUTCOMES)[number];

/**
 * The assertion evaluation space: the five requestable outcomes plus
 * INCONCLUSIVE, which is recorded with a reason and never counted as passed.
 */
export const EVALUATION_OUTCOMES = [...EXPECTED_OUTCOMES, "INCONCLUSIVE"] as const;

export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];

/** Select-field option lists sent to the model are truncated to this many entries. */
export const MAX_SELECT_OPTIONS = 20;

/** No single generated value may exceed this length. */
export const MAX_GENERATED_VALUE_LENGTH = 500;

/** Shape of an `elementId` — the inspector's positional identifier. */
export const ELEMENT_ID_PATTERN = /^element_\d+$/;

export type FormFieldKind =
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "search"
  | "other";

/**
 * Sanitized description of a single form field.
 *
 * Note the absence of `value`: pre-filled values may hold user or session data
 * and are never forwarded to the model.
 */
export interface FormFieldSnapshot {
  elementId: string;
  kind: FormFieldKind;
  /** The HTML `type` attribute, when present (`email`, `tel`, `number`, ...). */
  type?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  required: boolean;
  disabled: boolean;
  /** Validation constraints are flattened directly onto the field, per DESIGN-DECISIONS.md §3. */
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  pattern?: string;
  /** Select/radio choices, capped at MAX_SELECT_OPTIONS. */
  options?: string[];
}

/**
 * The unit of work sent to the LLM. Carries form *metadata* only — no selectors,
 * no locator descriptors, no raw action URL.
 */
export interface FormSnapshot {
  /** Stable per-run identifier used to correlate test cases and classifier decisions. */
  formId: string;
  /** The form element's own inspector id. */
  elementId: string;
  method?: string;
  /** Normalized route family of the page the form was found on. */
  routeFamily?: string;
  apparentPurpose?: string;
  fields: FormFieldSnapshot[];
  /** The primary submit control's visible label, e.g. "Request Service". */
  submitLabel?: string;
}

export interface FormFieldValue {
  elementId: string;
  /** Capped at MAX_GENERATED_VALUE_LENGTH. */
  value: string;
}

/**
 * `kind` is the only requestable outcome value; `elementId`, when present, must
 * belong to the form the test case targets — required for the two field-scoped
 * outcomes (VALIDATION_ERROR, FIELD_ERROR), absent for the three page-scoped ones.
 */
export interface FormExpectedOutcome {
  kind: ExpectedOutcome;
  elementId?: string;
}

/**
 * A single form-level test case returned by the LLM.
 *
 * `intent` is descriptive only. Severity is derived mechanically from the
 * observed outcome and never from anything the model wrote here.
 */
export interface FormTestCase {
  caseId: string;
  /** Must match the `formId` of one of the snapshots sent in the same batch. */
  formId: string;
  testType: TestingType;
  intent: string;
  inputs: FormFieldValue[];
  submit: boolean;
  expectedOutcome: FormExpectedOutcome;
}

export interface FormTestPlan {
  testCases: FormTestCase[];
}
