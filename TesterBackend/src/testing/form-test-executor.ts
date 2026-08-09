import type { Page } from "playwright";
import { locatorFromDescriptor } from "../actions/playwright-action-executor.js";
import { collectOutcomeFacts, evaluateOutcome, type OutcomeObservation } from "../assertions/outcome-evaluator.js";
import { outcomePassed, severityForOutcome } from "../reporting/severity.js";
import type { FormTestCase } from "../types/llm-contract.js";
import type { TestCaseResult } from "../types/report.js";
import type { ElementInventoryItem, InspectedForm } from "../types/testing.js";

/**
 * Executes a planned `FormTestCase` and judges it against DESIGN-DECISIONS.md §6.
 *
 * Everything model-authored is inert here: `intent` becomes the test's display
 * name and nothing else. Pass/fail comes from `outcomePassed`, severity from
 * §8's table via `severityForOutcome` — neither can be reached by LLM text.
 *
 * An unobservable result is INCONCLUSIVE with a recorded reason, never a pass:
 * this executor's job is to report what it could and could not establish, not
 * to manufacture a verdict.
 */
export interface FormExecutionTarget {
  form: InspectedForm;
  /** Set when §4 soft-blocked the form: it may be filled, never submitted. */
  softBlockedSignal?: string;
}

export interface FormTestExecutionInput {
  page: Page;
  testCase: FormTestCase;
  target: FormExecutionTarget;
  elementMap: Map<string, ElementInventoryItem>;
  /** The run-level consent gate (§4). False forces every case to fill-only. */
  allowFormSubmission: boolean;
  screenshotOnFailure: (page: Page, name: string, description: string) => Promise<TestCaseResult["evidence"]>;
  runId: string;
}

export async function executeFormTestCase(input: FormTestExecutionInput): Promise<TestCaseResult> {
  const { page, testCase, target, elementMap, allowFormSubmission } = input;
  const reproductionSteps: string[] = [`Open ${page.url()}`];
  const urlBefore = page.url();

  const blockedReason = submissionBlockReason(testCase, target, allowFormSubmission);

  try {
    for (const field of testCase.inputs) {
      const element = elementMap.get(field.elementId);
      if (!element) {
        // The plan referenced a field that is no longer on the page. That is
        // an absence of evidence about the target, not a defect in it.
        return inconclusive(
          input,
          `Planned field ${field.elementId} was not present on the page at execution time.`,
          reproductionSteps,
        );
      }
      await locatorFromDescriptor(page, element.locator).fill(field.value, { timeout: 5000 });
      reproductionSteps.push(`Fill ${describe(element)} with "${field.value}"`);
    }

    if (blockedReason) {
      // Filled but deliberately not submitted, so there is no post-submit
      // outcome to judge. Reported as INCONCLUSIVE with the blocking reason.
      return inconclusive(input, blockedReason, reproductionSteps);
    }

    if (testCase.submit) {
      const submitControl = target.form.submitControls.find((control) => !control.hidden);
      if (!submitControl) {
        return inconclusive(input, "Form has no visible submit control to activate.", reproductionSteps);
      }
      await locatorFromDescriptor(page, submitControl.locator).click({ timeout: 5000 });
      reproductionSteps.push(`Click ${describe(submitControl)}`);
    }
  } catch (error) {
    // A Playwright failure here is a fact about our interaction, not a proven
    // defect in the target, so it is INCONCLUSIVE rather than FAILED.
    return inconclusive(input, `Interaction failed: ${error instanceof Error ? error.message : String(error)}`, reproductionSteps);
  }

  const targetElementId = testCase.expectedOutcome.elementId ?? testCase.inputs[0]?.elementId;
  const targetSelector = targetElementId ? selectorFor(elementMap.get(targetElementId)) : undefined;

  const facts = await collectOutcomeFacts({ page, urlBefore, targetSelector });
  const observation = evaluateOutcome(testCase.expectedOutcome.kind, facts);

  return buildResult(input, observation, reproductionSteps);
}

/** §4 and the consent gate, in the order that makes the recorded reason most specific. */
function submissionBlockReason(
  testCase: FormTestCase,
  target: FormExecutionTarget,
  allowFormSubmission: boolean,
): string | undefined {
  if (!testCase.submit) return undefined;
  if (target.softBlockedSignal) {
    return `Form soft-blocked by the privileged-form classifier (${target.softBlockedSignal}); filled but not submitted.`;
  }
  if (!allowFormSubmission) {
    return "Form submission is disabled for this run (allowFormSubmission is false); filled but not submitted.";
  }
  return undefined;
}

async function inconclusive(
  input: FormTestExecutionInput,
  reason: string,
  reproductionSteps: string[],
): Promise<TestCaseResult> {
  return buildResult(
    input,
    {
      observed: "INCONCLUSIVE",
      reason,
      urlBefore: input.page.url(),
      urlAfter: input.page.url(),
      settled: false,
    },
    reproductionSteps,
  );
}

async function buildResult(
  input: FormTestExecutionInput,
  observation: OutcomeObservation,
  reproductionSteps: string[],
): Promise<TestCaseResult> {
  const { testCase } = input;
  const expected = testCase.expectedOutcome.kind;
  const passed = outcomePassed(expected, observation.observed);
  const severity = severityForOutcome({ expected, observed: observation.observed });

  const status = passed ? "PASSED" : observation.observed === "INCONCLUSIVE" ? "INCONCLUSIVE" : "FAILED";
  const evidence = passed
    ? []
    : await input.screenshotOnFailure(
        input.page,
        `${input.runId}-${testCase.caseId}-${observation.observed.toLowerCase()}`,
        `Expected ${expected}, observed ${observation.observed}.`,
      );

  return {
    id: testCase.caseId,
    // The model's intent is a label. It reaches no decision above.
    name: testCase.intent || `${testCase.formId} — ${expected}`,
    type: testCase.testType,
    status,
    steps: [],
    assertions: [],
    expectedResult: `${expected}${testCase.expectedOutcome.elementId ? ` on ${testCase.expectedOutcome.elementId}` : ""}`,
    actualResult: observation.reason
      ? `${observation.observed}: ${observation.reason}`
      : `${observation.observed} (url ${observation.urlBefore} -> ${observation.urlAfter})`,
    error: passed ? undefined : `Expected ${expected}, observed ${observation.observed}.`,
    evidence,
    reproductionSteps,
    severity,
    confidence: observation.observed === "INCONCLUSIVE" ? 0.3 : 0.9,
  };
}

function selectorFor(element: ElementInventoryItem | undefined): string | undefined {
  // collectOutcomeFacts runs inside the page, so it needs something
  // document.querySelector understands. The inventory usually prefers a
  // role/label locator, which has no DOM equivalent — falling back to
  // `undefined` there silently disabled every field-scoped outcome and made
  // real VALIDATION_ERRORs read as NO_NAVIGATION.
  if (!element) return undefined;
  if (element.cssSelector) return element.cssSelector;
  return element.locator.strategy === "css" ? element.locator.value : undefined;
}

function describe(element: ElementInventoryItem): string {
  return element.label ?? element.name ?? element.text ?? element.accessibleName ?? element.id;
}
