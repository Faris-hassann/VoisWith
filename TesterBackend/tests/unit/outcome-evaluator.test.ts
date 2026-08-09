import { describe, expect, it } from "vitest";
import { POST_SUBMIT_SETTLE_MS, evaluateOutcome, type PageOutcomeFacts } from "../../src/assertions/outcome-evaluator.js";
import { outcomePassed } from "../../src/reporting/severity.js";

/**
 * DESIGN-DECISIONS.md §6, evaluated against synthetic facts so the table
 * itself is tested rather than Playwright. INCONCLUSIVE is result-space only
 * (Phase 1) and is never counted as passed.
 */
const SETTLED_NOTHING: PageOutcomeFacts = {
  urlBefore: "https://example.com/contact",
  urlAfter: "https://example.com/contact",
  targetInvalid: false,
  targetContainerError: false,
  pageErrorVisible: false,
  successElementVisible: false,
  settled: true,
};

function facts(overrides: Partial<PageOutcomeFacts> = {}): PageOutcomeFacts {
  return { ...SETTLED_NOTHING, ...overrides };
}

const NAVIGATED = { urlAfter: "https://example.com/thanks" };

describe("evaluateOutcome — §6 table", () => {
  it("observes VALIDATION_ERROR on a native/aria invalid target with the URL unchanged", () => {
    expect(evaluateOutcome("VALIDATION_ERROR", facts({ targetInvalid: true })).observed).toBe("VALIDATION_ERROR");
    expect(evaluateOutcome("VALIDATION_ERROR", facts({ targetContainerError: true })).observed).toBe("VALIDATION_ERROR");
  });

  it("refuses VALIDATION_ERROR when the form navigated away — §6 requires URL unchanged", () => {
    const result = evaluateOutcome("VALIDATION_ERROR", facts({ targetInvalid: true, ...NAVIGATED }));
    expect(result.observed).toBe("SUBMIT_ACCEPTED");
    expect(outcomePassed("VALIDATION_ERROR", result.observed)).toBe(false);
  });

  it("scopes FIELD_ERROR strictly to the target container", () => {
    expect(evaluateOutcome("FIELD_ERROR", facts({ targetContainerError: true })).observed).toBe("FIELD_ERROR");
    // An error elsewhere on the page is not this field's error.
    expect(evaluateOutcome("FIELD_ERROR", facts({ pageErrorVisible: true })).observed).toBe("ERROR_MESSAGE_SHOWN");
  });

  it("observes SUBMIT_ACCEPTED on navigation or a success element", () => {
    expect(evaluateOutcome("SUBMIT_ACCEPTED", facts(NAVIGATED)).observed).toBe("SUBMIT_ACCEPTED");
    expect(evaluateOutcome("SUBMIT_ACCEPTED", facts({ successElementVisible: true })).observed).toBe("SUBMIT_ACCEPTED");
  });

  it("refuses SUBMIT_ACCEPTED when visible error text accompanies the success", () => {
    const withPageError = evaluateOutcome("SUBMIT_ACCEPTED", facts({ successElementVisible: true, pageErrorVisible: true }));
    expect(withPageError.observed).toBe("ERROR_MESSAGE_SHOWN");

    const withFieldError = evaluateOutcome("SUBMIT_ACCEPTED", facts({ successElementVisible: true, targetInvalid: true }));
    expect(withFieldError.observed).toBe("FIELD_ERROR");
  });

  it("observes NO_NAVIGATION when the URL is unchanged after the wait", () => {
    expect(evaluateOutcome("NO_NAVIGATION", facts()).observed).toBe("NO_NAVIGATION");
    expect(evaluateOutcome("NO_NAVIGATION", facts(NAVIGATED)).observed).toBe("SUBMIT_ACCEPTED");
  });

  it("observes ERROR_MESSAGE_SHOWN for any visible error-role element", () => {
    expect(evaluateOutcome("ERROR_MESSAGE_SHOWN", facts({ pageErrorVisible: true })).observed).toBe("ERROR_MESSAGE_SHOWN");
  });

  it("falls through to INCONCLUSIVE with a recorded reason when nothing is observable", () => {
    const result = evaluateOutcome("SUBMIT_ACCEPTED", facts({ settled: false }));
    expect(result.observed).toBe("INCONCLUSIVE");
    expect(result.reason).toContain(String(POST_SUBMIT_SETTLE_MS));
    expect(result.reason).toBeTruthy();
  });

  it("does not report INCONCLUSIVE merely because the page never settled, if something was observable", () => {
    // A navigation is observable evidence even when neither network idle nor a
    // mutation was caught inside the window.
    expect(evaluateOutcome("SUBMIT_ACCEPTED", facts({ settled: false, ...NAVIGATED })).observed).toBe("SUBMIT_ACCEPTED");
  });

  it("never counts INCONCLUSIVE as a pass, for any expectation", () => {
    const inconclusive = evaluateOutcome("VALIDATION_ERROR", facts({ settled: false }));
    expect(inconclusive.observed).toBe("INCONCLUSIVE");
    for (const expected of ["VALIDATION_ERROR", "FIELD_ERROR", "SUBMIT_ACCEPTED", "NO_NAVIGATION", "ERROR_MESSAGE_SHOWN"] as const) {
      expect(outcomePassed(expected, "INCONCLUSIVE")).toBe(false);
    }
  });

  it("always reports the URLs it compared, so a verdict can be audited", () => {
    const result = evaluateOutcome("NO_NAVIGATION", facts(NAVIGATED));
    expect(result.urlBefore).toBe("https://example.com/contact");
    expect(result.urlAfter).toBe("https://example.com/thanks");
  });
});
