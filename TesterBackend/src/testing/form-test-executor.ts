import type { Page } from "playwright";
import { locatorFromDescriptor } from "../actions/playwright-action-executor.js";
import { collectOutcomeFacts, evaluateOutcome, type OutcomeObservation } from "../assertions/outcome-evaluator.js";
import { withCursorSuppressed } from "../browser/browser-visual-agent.js";
import { outcomePassed, severityForOutcome } from "../reporting/severity.js";
import type { FormTestCase } from "../types/llm-contract.js";
import type { TestCaseResult } from "../types/report.js";
import type { ElementInventoryItem, InspectedForm } from "../types/testing.js";
import type { FormTestCaseState, RunEventSink } from "../runs/run-events.js";
import { delay } from "../utilities/timeout.js";

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
  pageUrl?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  planningSource?: "ai" | "deterministic" | "mixed";
  onEvent?: RunEventSink;
  extendDeadlineMs?: (milliseconds: number) => void;
  control?: {
    isStopped: () => boolean;
    waitWhilePaused: () => Promise<void>;
  };
}

export const SUBMISSION_HOLD_SECONDS = 30;

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
      const submitControl = selectSubmitControl(target.form.submitControls, testCase.intent);
      if (!submitControl) {
        return inconclusive(input, "Form has no visible submit control to activate.", reproductionSteps);
      }
      const selectedButton = describe(submitControl);
      await holdBeforeSubmit(input, selectedButton);
      if (input.control?.isStopped()) {
        return inconclusive(input, "Run stopped during the pre-submit hold; click was cancelled.", reproductionSteps);
      }
      emitCase(input, "submitting", { selectedButton });
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

  const facts = await withCursorSuppressed(page, () => collectOutcomeFacts({ page, urlBefore, targetSelector }));
  const observation = evaluateOutcome(testCase.expectedOutcome.kind, facts);

  return buildResult(input, observation, reproductionSteps);
}

async function holdBeforeSubmit(input: FormTestExecutionInput, selectedButton: string): Promise<void> {
  input.extendDeadlineMs?.(SUBMISSION_HOLD_SECONDS * 1000);
  const startedAt = new Date().toISOString();
  emitCase(input, "holding", {
    selectedButton,
    holdStartedAt: startedAt,
    holdDurationSeconds: SUBMISSION_HOLD_SECONDS,
    holdRemainingSeconds: SUBMISSION_HOLD_SECONDS,
  });
  let remainingMs = SUBMISSION_HOLD_SECONDS * 1000;
  while (remainingMs > 0) {
    if (input.control?.isStopped()) {
      emitCase(input, "inconclusive", {
        selectedButton,
        holdStartedAt: startedAt,
        holdDurationSeconds: SUBMISSION_HOLD_SECONDS,
        holdRemainingSeconds: Math.ceil(remainingMs / 1000),
        resultMessage: "Run stopped during the pre-submit hold; click was cancelled.",
      });
      return;
    }
    await input.control?.waitWhilePaused();
    const step = Math.min(250, remainingMs);
    await delay(step);
    remainingMs -= step;
  }
}

function emitCase(
  input: FormTestExecutionInput,
  status: "holding" | "submitting" | "inconclusive",
  updates: Partial<FormTestCaseState>,
): void {
  input.onEvent?.({
    runId: input.runId,
    type: `test_case.${status}`,
    status: status === "inconclusive" ? "skipped" : "started",
    message: status === "holding"
      ? `Holding ${SUBMISSION_HOLD_SECONDS}s before submitting: ${input.testCase.intent}.`
      : status === "submitting"
        ? `Submitting form test case: ${input.testCase.intent}.`
        : updates.resultMessage ?? `Form test case inconclusive: ${input.testCase.intent}.`,
    pageUrl: input.pageUrl ?? input.page.url(),
    role: input.role,
    viewport: input.viewport,
    locale: input.locale,
    formTestCase: {
      runId: input.runId,
      caseId: input.testCase.caseId,
      formId: input.testCase.formId,
      pageUrl: input.pageUrl ?? input.page.url(),
      role: input.role,
      viewport: input.viewport,
      locale: input.locale,
      planningSource: input.planningSource ?? "mixed",
      testCase: input.testCase,
      status,
      submit: input.testCase.submit,
      ...updates,
    },
  });
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

/** Selects the most relevant usable commit control when a form exposes more than one. */
export function selectSubmitControl(
  controls: ElementInventoryItem[],
  intent: string,
): ElementInventoryItem | undefined {
  const intentWords = new Set(intent.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const actionPattern = /\b(submit|save|send|continue|next|apply|confirm|done|create|update|register|sign\s*up|log\s*in)\b/i;
  return controls
    .filter((control) => !control.hidden && !control.disabled)
    .map((control, index) => {
      const text = [control.text, control.accessibleName, control.label, control.name, control.value].filter(Boolean).join(" ").toLowerCase();
      const matchingWords = (text.match(/[a-z0-9]+/g) ?? []).filter((word) => intentWords.has(word)).length;
      const nativeSubmit = control.type?.toLowerCase() === "submit" || control.tagName.toLowerCase() === "button";
      return { control, index, score: matchingWords * 10 + (actionPattern.test(text) ? 4 : 0) + (nativeSubmit ? 2 : 0) };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.control;
}
