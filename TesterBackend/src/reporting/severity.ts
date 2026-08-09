import type { IssueSeverity } from "../types/report.js";
import type { EvaluationOutcome, ExpectedOutcome } from "../types/llm-contract.js";

/**
 * DESIGN-DECISIONS.md §8 — severity is assigned mechanically, never by the LLM.
 *
 * Note what these functions do NOT accept: a `FormTestCase`, an `intent`, or any
 * other model-authored string. The LLM's `intent` is displayed as a description
 * only, and the type signature is the enforcement — model text cannot reach a
 * severity decision even by accident.
 */

/** §8 CRITICAL row: infrastructure-level failures that break the page or the form outright. */
export type CriticalFailureKind = "page_load_failed" | "login_failed" | "uncaught_exception_broke_form";

/** §8 MEDIUM row: page-level observations that are real but not blocking. */
export type PageObservationKind = "console_error" | "failed_network_request" | "missing_validation_attributes";

/** §8 LOW row. */
export type QualityObservationKind = "accessibility_name_gap" | "slow_page_timing";

/** §8 INFO row. */
export type InformationalKind = "coverage_limitation" | "form_skipped" | "form_blocked";

export function severityForCriticalFailure(_kind: CriticalFailureKind): IssueSeverity {
  return "CRITICAL";
}

export function severityForPageObservation(_kind: PageObservationKind): IssueSeverity {
  return "MEDIUM";
}

export function severityForQualityObservation(_kind: QualityObservationKind): IssueSeverity {
  return "LOW";
}

export function severityForInformational(_kind: InformationalKind): IssueSeverity {
  return "INFORMATIONAL";
}

/** A 5xx anywhere in the run is HIGH per §8, independent of any test expectation. */
export function severityForServerError(): IssueSeverity {
  return "HIGH";
}

export interface OutcomeSeverityInput {
  expected: ExpectedOutcome;
  observed: EvaluationOutcome;
}

/**
 * Maps an expectation/observation mismatch onto §8's table.
 *
 * The two HIGH rows this covers are "form accepted invalid input" (an error was
 * expected and the submit went through) and "submit did nothing" (acceptance was
 * expected and nothing happened at all). Everything else that merely differs is
 * MEDIUM, and INCONCLUSIVE is INFO because it is an absence of evidence, not a
 * defect — it is separately never counted as passed.
 */
export function severityForOutcome({ expected, observed }: OutcomeSeverityInput): IssueSeverity | undefined {
  if (observed === expected) return undefined;

  if (observed === "INCONCLUSIVE") return "INFORMATIONAL";

  const errorWasExpected = expected === "VALIDATION_ERROR" || expected === "FIELD_ERROR" || expected === "ERROR_MESSAGE_SHOWN";
  if (errorWasExpected && observed === "SUBMIT_ACCEPTED") {
    // The form took input it should have rejected.
    return "HIGH";
  }

  if (expected === "SUBMIT_ACCEPTED" && observed === "NO_NAVIGATION") {
    // Submit did nothing observable.
    return "HIGH";
  }

  return "MEDIUM";
}

/** §6: INCONCLUSIVE is never counted as passed. */
export function outcomePassed(expected: ExpectedOutcome, observed: EvaluationOutcome): boolean {
  return observed !== "INCONCLUSIVE" && observed === expected;
}
