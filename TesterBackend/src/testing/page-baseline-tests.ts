import type { TestingType } from "./test-types.js";
import type { PageSnapshot } from "../types/testing.js";
import type { TestCaseResult, TestStatus } from "../types/report.js";

interface BaselineInput {
  snapshot: PageSnapshot;
  selectedTypes: TestingType[];
  credentialsProvided: boolean;
  roleCount?: number;
}

export function buildPageBaselineTests(input: BaselineInput): TestCaseResult[] {
  const tests: TestCaseResult[] = [];
  const has = (type: TestingType) => input.selectedTypes.includes(type);

  if (has("SMOKE")) {
    tests.push(
      baselineResult({
        id: "baseline-smoke",
        name: "Page loads and can be inspected",
        type: "SMOKE",
        status: input.snapshot.url ? "PASSED" : "FAILED",
        expected: "Page navigates and produces an inspectable snapshot.",
        actual: `Title: ${input.snapshot.title || "untitled"}, elements: ${input.snapshot.elements.length}`,
      }),
    );
  }

  if (has("PAGE_DISCOVERY")) {
    tests.push(
      baselineResult({
        id: "baseline-page-discovery",
        name: "Page discovery inventory",
        type: "PAGE_DISCOVERY",
        status: "PASSED",
        expected: "Internal links are extracted for DFS discovery.",
        actual: `${input.snapshot.links.filter((link) => link.internal).length} internal links, ${input.snapshot.links.length} total links.`,
      }),
    );
  }

  if (has("NAVIGATION")) {
    const internalLinks = input.snapshot.links.filter((link) => link.internal);
    tests.push(
      baselineResult({
        id: "baseline-navigation",
        name: "Navigation candidates detected",
        type: "NAVIGATION",
        status: internalLinks.length > 0 ? "PASSED" : "INCONCLUSIVE",
        expected: "At least one same-origin navigation candidate is available when the page contains links.",
        actual: `${internalLinks.length} same-origin navigation candidates found.`,
      }),
    );
  }

  if (has("LINKS")) {
    tests.push(
      baselineResult({
        id: "baseline-links",
        name: "Link inventory and failed request check",
        type: "LINKS",
        status: input.snapshot.failedRequests.length === 0 ? "PASSED" : "FAILED",
        expected: "No failed network requests are observed while loading the page.",
        actual: `${input.snapshot.links.length} links inventoried, ${input.snapshot.failedRequests.length} failed requests observed.`,
      }),
    );
  }

  if (has("FORMS")) {
    if (input.snapshot.forms.length === 0) {
      tests.push(
        baselineResult({
          id: "baseline-forms-none",
          name: "Form inventory",
          type: "FORMS",
          status: "SKIPPED",
          expected: "Forms are inventoried when present.",
          actual: "No forms were detected on this page.",
        }),
      );
    } else {
      input.snapshot.forms.forEach((form, index) => {
        tests.push(
          baselineResult({
            id: `baseline-form-${index + 1}`,
            name: `Form ${index + 1} inventory`,
            type: "FORMS",
            status: "PASSED",
            expected: "Form fields and submit controls are detected before safe interaction planning.",
            actual: `${form.fields.length} fields, ${form.submitControls.length} submit controls, method: ${form.method ?? "unknown"}.`,
          }),
        );
      });
    }
  }

  if (has("FORM_VALIDATION")) {
    const fieldsWithValidation = input.snapshot.forms.flatMap((form) =>
      form.fields.filter((field) => field.required || Object.keys(field.validation ?? {}).length > 0),
    );
    tests.push(
      baselineResult({
        id: "baseline-form-validation",
        name: "Form validation attributes observed",
        type: "FORM_VALIDATION",
        status: input.snapshot.forms.length === 0 ? "SKIPPED" : fieldsWithValidation.length > 0 ? "PASSED" : "INCONCLUSIVE",
        expected: "Required fields or validation attributes are visible when forms declare them.",
        actual: `${fieldsWithValidation.length} fields with required or validation attributes.`,
      }),
    );
  }

  if (has("AUTHENTICATION")) {
    tests.push(
      baselineResult({
        id: "baseline-authentication",
        name: "Authentication prerequisite",
        type: "AUTHENTICATION",
        status: input.credentialsProvided ? "PASSED" : "SKIPPED",
        expected: "Credentials are supplied when authentication testing is selected.",
        actual: input.credentialsProvided ? "Credentials were supplied for this run." : "No credentials supplied.",
      }),
    );
  }

  if (has("SESSION")) {
    tests.push(
      baselineResult({
        id: "baseline-session",
        name: "Session testing prerequisite",
        type: "SESSION",
        status: input.credentialsProvided ? "INCONCLUSIVE" : "SKIPPED",
        expected: "Session behavior can be observed after authenticated workflows.",
        actual: input.credentialsProvided
          ? "Credentials were supplied; deeper session behavior depends on page workflows."
          : "No credentials supplied.",
      }),
    );
  }

  if (has("AUTHORIZATION")) {
    tests.push(
      baselineResult({
        id: "baseline-authorization",
        name: "Authorization testing prerequisite",
        type: "AUTHORIZATION",
        status: (input.roleCount ?? 0) >= 2 ? "PASSED" : "SKIPPED",
        expected: "Multiple role credentials are available.",
        actual:
          (input.roleCount ?? 0) >= 2
            ? `${input.roleCount} role credential sets are available for role-isolation comparisons.`
            : "Multiple role credentials were not supplied.",
      }),
    );
  }

  if (has("API_NETWORK")) {
    tests.push(
      baselineResult({
        id: "baseline-api-network",
        name: "Observed API and network behavior",
        type: "API_NETWORK",
        status: input.snapshot.failedRequests.length === 0 ? "PASSED" : "FAILED",
        expected: "Observed API/network requests complete without failures during page load and safe UI workflows.",
        actual: `${input.snapshot.observedApiCalls.length} API-like calls, ${input.snapshot.failedRequests.length} failed requests, ${duplicateApiCalls(input.snapshot).length} duplicate API observations.`,
      }),
    );
  }

  if (has("CONSOLE_ERRORS")) {
    tests.push(
      baselineResult({
        id: "baseline-console-errors",
        name: "Console error check",
        type: "CONSOLE_ERRORS",
        status: input.snapshot.consoleErrors.length === 0 ? "PASSED" : "FAILED",
        expected: "No browser console errors are observed.",
        actual: `${input.snapshot.consoleErrors.length} console errors or warnings observed.`,
      }),
    );
  }

  if (has("ERROR_HANDLING")) {
    tests.push(
      baselineResult({
        id: "baseline-error-handling",
        name: "Visible error state check",
        type: "ERROR_HANDLING",
        status: input.snapshot.visibleValidationErrors.length === 0 ? "PASSED" : "INCONCLUSIVE",
        expected: "No visible error or validation states are present after initial page load.",
        actual: `${input.snapshot.visibleValidationErrors.length} visible error-like messages observed.`,
      }),
    );
  }

  if (has("PERFORMANCE_BASIC")) {
    tests.push(
      baselineResult({
        id: "baseline-performance",
        name: "Basic browser performance observations",
        type: "PERFORMANCE_BASIC",
        status: input.snapshot.performance.length > 0 ? "PASSED" : "INCONCLUSIVE",
        expected: "Basic browser timing observations are collected.",
        actual: `${input.snapshot.performance.length} timing observations collected. This is not load testing.`,
      }),
    );
  }

  if (has("PASSIVE_SECURITY")) {
    const url = new URL(input.snapshot.url);
    tests.push(
      baselineResult({
        id: "baseline-passive-security",
        name: "Passive HTTPS observation",
        type: "PASSIVE_SECURITY",
        status: url.protocol === "https:" ? "PASSED" : "INCONCLUSIVE",
        expected: "HTTPS is used for non-local testing targets.",
        actual: `Page protocol is ${url.protocol}. No exploitative testing was performed.`,
      }),
    );
  }

  if (has("ACCESSIBILITY_TECHNICAL")) {
    const failedUiObservations = input.snapshot.uiObservations.filter((observation) => observation.status === "FAILED");
    const namedInteractive = input.snapshot.elements.filter((element) =>
      ["button", "link", "input", "select", "textarea"].includes(element.kind),
    ).filter((element) => element.accessibleName || element.label || element.placeholder || element.text);
    tests.push(
      baselineResult({
        id: "baseline-accessibility-technical",
        name: "Technical accessible-name inventory",
        type: "ACCESSIBILITY_TECHNICAL",
        status: failedUiObservations.length > 0 ? "FAILED" : namedInteractive.length > 0 ? "PASSED" : "INCONCLUSIVE",
        expected: "Interactive elements expose names and no obvious technical layout/accessibility failures are observed.",
        actual: `${namedInteractive.length} named interactive elements out of ${input.snapshot.elements.length} inventoried elements. UI observations: ${input.snapshot.uiObservations.map((item) => `${item.name}=${item.status}`).join(", ") || "none"}.`,
      }),
    );
  }

  for (const type of ["REGRESSION_BASELINE", "FILE_UPLOAD_SAFE", "END_TO_END", "BUSINESS_RULES", "RELIABILITY_BASIC", "CHROMIUM_COMPATIBILITY", "POSITIVE", "NEGATIVE", "BOUNDARY", "DATA_INTEGRITY_OBSERVABLE"] as TestingType[]) {
    if (has(type) && !tests.some((test) => test.type === type)) {
      tests.push(
        baselineResult({
          id: `baseline-${type.toLowerCase().replaceAll("_", "-")}`,
          name: `${type.replaceAll("_", " ")} baseline coverage`,
          type,
          status: type === "REGRESSION_BASELINE" ? "SKIPPED" : "INCONCLUSIVE",
          expected: "AI planner or future deterministic workflow support provides deeper execution for this testing type.",
          actual:
            type === "REGRESSION_BASELINE"
              ? "No regression baseline is available in backend v1."
              : "Page was inspected; deeper workflow execution depends on AI planning and safe element actions.",
        }),
      );
    }
  }

  return tests;
}

function duplicateApiCalls(snapshot: PageSnapshot): string[] {
  const counts = new Map<string, number>();
  for (const call of snapshot.observedApiCalls) {
    if (!call.duplicateKey || !["POST", "PUT", "PATCH"].includes(call.method)) continue;
    counts.set(call.duplicateKey, (counts.get(call.duplicateKey) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function baselineResult(input: {
  id: string;
  name: string;
  type: TestingType;
  status: TestStatus;
  expected: string;
  actual: string;
}): TestCaseResult {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    status: input.status,
    priority: "MEDIUM",
    steps: [
      {
        action: {
          action: "ASSERT_VISIBLE",
          description: "Deterministic page snapshot check",
        },
        status: input.status,
        expectedResult: input.expected,
        actualResult: input.actual,
      },
    ],
    assertions: [],
    expectedResult: input.expected,
    actualResult: input.actual,
    error: ["FAILED", "ERROR"].includes(input.status) ? input.actual : undefined,
    evidence: [],
    reproductionSteps: ["Navigate to page", "Inspect page snapshot", "Evaluate deterministic baseline check"],
    severity: input.status === "FAILED" ? "MEDIUM" : input.status === "SKIPPED" ? "INFORMATIONAL" : undefined,
    confidence: input.status === "PASSED" ? 0.9 : 0.75,
  };
}
