import type { Page } from "playwright";
import type { EvaluationOutcome, ExpectedOutcome } from "../types/llm-contract.js";

/** DESIGN-DECISIONS.md §6: wait up to 5s for network idle or DOM mutation. */
export const POST_SUBMIT_SETTLE_MS = 5000;

export interface OutcomeObservation {
  /** What was actually observed — may be INCONCLUSIVE, which is never requestable. */
  observed: EvaluationOutcome;
  /** Always populated for INCONCLUSIVE; §6 requires the reason be recorded. */
  reason?: string;
  urlBefore: string;
  urlAfter: string;
  settled: boolean;
}

/** Raw facts read out of the page once, so evaluation itself is pure and testable. */
export interface PageOutcomeFacts {
  urlBefore: string;
  urlAfter: string;
  /** Native :invalid or [aria-invalid=true] on the targeted field. */
  targetInvalid: boolean;
  /** New visible text inside the targeted field's container. */
  targetContainerError: boolean;
  /** Any visible error-role element anywhere on the page. */
  pageErrorVisible: boolean;
  /** [role=status], .success, or text matching thank|success|received|submitted. */
  successElementVisible: boolean;
  /** Whether the 5s settle window observed network idle or a DOM mutation. */
  settled: boolean;
}

const SUCCESS_TEXT = /thank|success|received|submitted/i;

/**
 * Evaluates §6's table verbatim against already-collected facts.
 *
 * Order matters: the field-scoped outcomes are checked before the page-scoped
 * ones so a validation error never reads as a bare NO_NAVIGATION. Anything not
 * positively observable falls through to INCONCLUSIVE with a reason — never to
 * a pass. INCONCLUSIVE is result-space only and can never be requested.
 */
export function evaluateOutcome(expected: ExpectedOutcome, facts: PageOutcomeFacts): OutcomeObservation {
  const urlChanged = facts.urlBefore !== facts.urlAfter;
  const base = { urlBefore: facts.urlBefore, urlAfter: facts.urlAfter, settled: facts.settled };

  if (!facts.settled && !urlChanged && !facts.targetInvalid && !facts.targetContainerError && !facts.pageErrorVisible && !facts.successElementVisible) {
    return { ...base, observed: "INCONCLUSIVE", reason: `Nothing observable within ${POST_SUBMIT_SETTLE_MS}ms: no navigation, no error, no success indicator.` };
  }

  switch (expected) {
    case "VALIDATION_ERROR": {
      // §6 requires URL unchanged — a form that navigated away did not surface
      // a client-side validation error, whatever else appeared.
      if (urlChanged) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      if (facts.targetInvalid || facts.targetContainerError) {
        return { ...base, observed: "VALIDATION_ERROR" };
      }
      if (facts.pageErrorVisible) {
        return { ...base, observed: "ERROR_MESSAGE_SHOWN" };
      }
      if (facts.successElementVisible) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      return { ...base, observed: "NO_NAVIGATION" };
    }

    case "FIELD_ERROR": {
      // Strictly scoped to the target's own container: an error elsewhere on
      // the page is ERROR_MESSAGE_SHOWN, not a field error.
      if (urlChanged) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      if (facts.targetInvalid || facts.targetContainerError) {
        return { ...base, observed: "FIELD_ERROR" };
      }
      if (facts.pageErrorVisible) {
        return { ...base, observed: "ERROR_MESSAGE_SHOWN" };
      }
      if (facts.successElementVisible) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      return { ...base, observed: "NO_NAVIGATION" };
    }

    case "SUBMIT_ACCEPTED": {
      const errorPresent = facts.pageErrorVisible || facts.targetInvalid || facts.targetContainerError;
      // §6: acceptance requires no visible error text, so an error alongside a
      // success banner is not an acceptance.
      if (errorPresent) {
        if (facts.targetInvalid || facts.targetContainerError) {
          return { ...base, observed: "FIELD_ERROR" };
        }
        return { ...base, observed: "ERROR_MESSAGE_SHOWN" };
      }
      if (urlChanged || facts.successElementVisible) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      return { ...base, observed: "NO_NAVIGATION" };
    }

    case "NO_NAVIGATION": {
      if (!urlChanged) {
        return { ...base, observed: "NO_NAVIGATION" };
      }
      return { ...base, observed: "SUBMIT_ACCEPTED" };
    }

    case "ERROR_MESSAGE_SHOWN": {
      if (facts.pageErrorVisible || facts.targetInvalid || facts.targetContainerError) {
        return { ...base, observed: "ERROR_MESSAGE_SHOWN" };
      }
      if (urlChanged || facts.successElementVisible) {
        return { ...base, observed: "SUBMIT_ACCEPTED" };
      }
      return { ...base, observed: "NO_NAVIGATION" };
    }

    default:
      return { ...base, observed: "INCONCLUSIVE", reason: `Unrecognized expected outcome: ${String(expected)}.` };
  }
}

/**
 * Waits out §6's settle window, then reads the page once.
 *
 * Resolves as soon as the network goes idle or the DOM mutates; a page that
 * does neither within the window is reported as unsettled, which is what
 * drives the INCONCLUSIVE fallback rather than a fabricated pass.
 */
export async function collectOutcomeFacts(input: {
  page: Page;
  urlBefore: string;
  targetSelector?: string;
}): Promise<PageOutcomeFacts> {
  const { page, urlBefore, targetSelector } = input;
  const settled = await waitForSettle(page);

  // Evaluated as a *string*, not a function: tsx/esbuild rewrites named
  // function expressions to reference its `__name` helper, which does not
  // exist in the page and throws `ReferenceError: __name is not defined`.
  // element-inventory.ts and login-detector.ts use strings for the same reason.
  const observed = (await page.evaluate(`(() => {
      const selector = ${JSON.stringify(targetSelector ?? null)};
      const successPattern = ${JSON.stringify(SUCCESS_TEXT.source)};

      function isVisible(element) {
        if (!element.getClientRects || element.getClientRects().length === 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      }
      function hasVisibleText(node) {
        return isVisible(node) && (node.textContent ?? "").trim().length > 0;
      }

      const target = selector ? document.querySelector(selector) : null;
      let targetInvalid = false;
      let targetContainerError = false;

      if (target) {
        const nativeInvalid = typeof target.checkValidity === "function" ? !target.checkValidity() : false;
        targetInvalid = nativeInvalid || target.getAttribute("aria-invalid") === "true";
        // Strictly the field's own container — §6 scopes FIELD_ERROR to it.
        const container = target.closest("label, .field, .form-group, .form-field, p, div");
        if (container) {
          targetContainerError = [...container.querySelectorAll("[role=alert], .error, .invalid, .validation-error, [aria-invalid=true]")]
            .some(hasVisibleText);
        }
      }

      const pageErrorVisible = [...document.querySelectorAll("[role=alert], .error, .invalid, .validation-error")]
        .some(hasVisibleText);

      const successNodes = [...document.querySelectorAll("[role=status], .success")].filter(isVisible);
      const bodyText = document.body ? document.body.innerText : "";
      const successElementVisible = successNodes.length > 0 || new RegExp(successPattern, "i").test(bodyText);

      return { targetInvalid, targetContainerError, pageErrorVisible, successElementVisible };
    })()`)) as Pick<
    PageOutcomeFacts,
    "targetInvalid" | "targetContainerError" | "pageErrorVisible" | "successElementVisible"
  >;

  return {
    urlBefore,
    urlAfter: page.url(),
    settled,
    ...observed,
  };
}

async function waitForSettle(page: Page): Promise<boolean> {
  const networkIdle = page
    .waitForLoadState("networkidle", { timeout: POST_SUBMIT_SETTLE_MS })
    .then(() => true)
    .catch(() => false);

  // Also a string, for the same `__name` reason as above.
  const domMutation = page
    .evaluate(`new Promise((resolve) => {
      let observer;
      const timer = setTimeout(() => {
        if (observer) observer.disconnect();
        resolve(false);
      }, ${POST_SUBMIT_SETTLE_MS});
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    })`)
    .then((mutated) => Boolean(mutated))
    .catch(() => false);

  const [idle, mutated] = await Promise.all([networkIdle, domMutation]);
  return idle || mutated;
}
