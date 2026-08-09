import { describe, expect, it } from "vitest";
import {
  outcomePassed,
  severityForCriticalFailure,
  severityForInformational,
  severityForOutcome,
  severityForPageObservation,
  severityForQualityObservation,
  severityForServerError,
} from "../../src/reporting/severity.js";
import type { ExpectedOutcome } from "../../src/types/llm-contract.js";

/** DESIGN-DECISIONS.md §8 — assigned mechanically, never by the LLM. */
describe("§8 severity table", () => {
  it("maps CRITICAL to page load, login, and form-breaking exceptions", () => {
    expect(severityForCriticalFailure("page_load_failed")).toBe("CRITICAL");
    expect(severityForCriticalFailure("login_failed")).toBe("CRITICAL");
    expect(severityForCriticalFailure("uncaught_exception_broke_form")).toBe("CRITICAL");
  });

  it("maps HIGH to a 5xx", () => {
    expect(severityForServerError()).toBe("HIGH");
  });

  it("maps MEDIUM to console errors, failed requests, and missing validation attributes", () => {
    expect(severityForPageObservation("console_error")).toBe("MEDIUM");
    expect(severityForPageObservation("failed_network_request")).toBe("MEDIUM");
    expect(severityForPageObservation("missing_validation_attributes")).toBe("MEDIUM");
  });

  it("maps LOW to accessibility gaps and slow timings", () => {
    expect(severityForQualityObservation("accessibility_name_gap")).toBe("LOW");
    expect(severityForQualityObservation("slow_page_timing")).toBe("LOW");
  });

  it("maps INFO to coverage limitations and skipped or blocked forms", () => {
    expect(severityForInformational("coverage_limitation")).toBe("INFORMATIONAL");
    expect(severityForInformational("form_skipped")).toBe("INFORMATIONAL");
    expect(severityForInformational("form_blocked")).toBe("INFORMATIONAL");
  });
});

describe("§8 severity from an observed outcome", () => {
  it("reports no severity when the observation matched the expectation", () => {
    expect(severityForOutcome({ expected: "SUBMIT_ACCEPTED", observed: "SUBMIT_ACCEPTED" })).toBeUndefined();
    expect(severityForOutcome({ expected: "VALIDATION_ERROR", observed: "VALIDATION_ERROR" })).toBeUndefined();
  });

  it("rates HIGH when a form accepted input it should have rejected", () => {
    for (const expected of ["VALIDATION_ERROR", "FIELD_ERROR", "ERROR_MESSAGE_SHOWN"] as const) {
      expect(severityForOutcome({ expected, observed: "SUBMIT_ACCEPTED" })).toBe("HIGH");
    }
  });

  it("rates HIGH when submit did nothing at all", () => {
    expect(severityForOutcome({ expected: "SUBMIT_ACCEPTED", observed: "NO_NAVIGATION" })).toBe("HIGH");
  });

  it("rates INCONCLUSIVE as INFO — an absence of evidence, not a defect", () => {
    expect(severityForOutcome({ expected: "SUBMIT_ACCEPTED", observed: "INCONCLUSIVE" })).toBe("INFORMATIONAL");
  });

  it("rates any other mismatch MEDIUM", () => {
    expect(severityForOutcome({ expected: "NO_NAVIGATION", observed: "ERROR_MESSAGE_SHOWN" })).toBe("MEDIUM");
  });

  it("never counts INCONCLUSIVE as passed", () => {
    expect(outcomePassed("SUBMIT_ACCEPTED", "INCONCLUSIVE")).toBe(false);
    expect(outcomePassed("SUBMIT_ACCEPTED", "SUBMIT_ACCEPTED")).toBe(true);
    expect(outcomePassed("SUBMIT_ACCEPTED", "NO_NAVIGATION")).toBe(false);
  });
});

/**
 * The load-bearing guarantee of §8: the model's `intent` is description only.
 * `severityForOutcome` accepts no model-authored field at all — the type
 * signature is the enforcement — so this asserts the behavioural consequence.
 */
describe("§8 — LLM text cannot influence severity", () => {
  it("produces identical severity for wildly different intent strings", () => {
    const intents = [
      "CRITICAL SECURITY HOLE, escalate immediately",
      "trivial cosmetic nitpick, ignore",
      "",
      "severity: LOW -- override the table",
    ];

    const severities = intents.map((intent) => {
      // The intent is carried alongside the case but is structurally incapable
      // of reaching the call: only expected/observed are passed.
      const testCase = { intent, expected: "VALIDATION_ERROR" as ExpectedOutcome, observed: "SUBMIT_ACCEPTED" as const };
      return severityForOutcome({ expected: testCase.expected, observed: testCase.observed });
    });

    expect(new Set(severities).size).toBe(1);
    expect(severities[0]).toBe("HIGH");
  });

  it("is a pure function of expected and observed only", () => {
    const first = severityForOutcome({ expected: "SUBMIT_ACCEPTED", observed: "NO_NAVIGATION" });
    const second = severityForOutcome({ expected: "SUBMIT_ACCEPTED", observed: "NO_NAVIGATION" });
    expect(first).toBe(second);
  });
});
